package app.dosing.companion;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.InputType;
import android.util.AtomicFile;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.net.ssl.HttpsURLConnection;

@CapacitorPlugin(name = "MedicineOcr")
public final class MedicineOcrPlugin extends Plugin {
    private static final int SCHEMA_VERSION = 1;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 45_000;
    private static final int MAX_API_KEY_CHARS = 512;
    private static final int MAX_PENDING_REQUESTS = 4;
    private static final int IV_BYTES = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String KEY_ALIAS = "companion-medicine-ocr-config-v1";
    private static final String CONFIG_FILE = "medicine-ocr-config-v1.bin";
    private static final String TEST_TEXT = "COMPANION OCR TEST 42";

    private final Object configLock = new Object();
    private final ExecutorService executor = Executors.newFixedThreadPool(2);
    private final ConcurrentHashMap<String, RequestControl> requests = new ConcurrentHashMap<>();

    @PluginMethod
    public void getStatus(PluginCall call) {
        try {
            SecretConfig config = loadConfig();
            call.resolve(status(config, config == null ? "not-configured" : config.checkState));
        } catch (OcrException exception) {
            try {
                call.resolve(status(null, "configuration-error"));
            } catch (OcrException statusException) {
                reject(call, statusException);
            }
        }
    }

    @PluginMethod
    public void configureKey(PluginCall call) {
        String projectId = trim(call.getString("projectId"));
        if (!MedicineOcrPolicy.isValidProjectId(projectId)) {
            reject(call, error("INVALID_PROJECT_ID", "Enter a valid Google Cloud project ID."));
            return;
        }
        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            reject(call, error("UNAVAILABLE", "The secure key dialog is unavailable."));
            return;
        }
        activity.runOnUiThread(() -> showKeyDialog(call, activity, projectId));
    }

    @PluginMethod
    public void removeKey(PluginCall call) {
        executor.execute(() -> {
            try {
                cancelAll();
                deleteConfigAndKey();
                call.resolve(status(null, "not-configured"));
            } catch (OcrException exception) {
                reject(call, exception);
            }
        });
    }

    @PluginMethod
    public void testConnection(PluginCall call) {
        String requestId = "connection-" + UUID.randomUUID();
        submit(call, requestId, control -> {
            SecretConfig config = requireConfig();
            byte[] image = testImage();
            try {
                JSObject result = performOcr(config, requestId, image, inspectImage(image, "image/png"), control);
                if (!normalized(result.getString("text")).contains(normalized(TEST_TEXT))) {
                    throw error("TEST_TEXT_NOT_FOUND", "The OCR service did not read the connection test image correctly.");
                }
                if (control.cancelled.get()) throw OcrException.cancelled();
                updateCheckState(config, "ok");
                JSObject response = new JSObject();
                response.put("schemaVersion", SCHEMA_VERSION);
                response.put("ok", true);
                call.resolve(response);
            } catch (OcrException exception) {
                if (!control.cancelled.get()) {
                    try {
                        updateCheckState(config, "failed");
                    } catch (OcrException ignored) {
                        // Preserve the original controlled failure.
                    }
                }
                throw exception;
            } finally {
                Arrays.fill(image, (byte) 0);
            }
        });
    }

    @PluginMethod
    public void extractPhoto(PluginCall call) {
        String requestId = call.getString("requestId");
        String encoded = call.getString("imageBase64");
        String mimeType = MedicineOcrPolicy.normalizeMimeType(call.getString("mimeType"));
        if (!MedicineOcrPolicy.isValidRequestId(requestId)) {
            reject(call, error("INVALID_REQUEST_ID", "The OCR request ID is invalid."));
            return;
        }
        if (!MedicineOcrPolicy.isSupportedMimeType(mimeType)) {
            reject(call, error("UNSUPPORTED_IMAGE", "Use a JPEG, PNG, or WebP image."));
            return;
        }
        if (encoded == null || encoded.isEmpty() || encoded.length() > encodedLengthLimit()) {
            reject(call, error("IMAGE_TOO_LARGE", "The photo exceeds the OCR size limit."));
            return;
        }
        submit(call, requestId, control -> {
            byte[] image;
            try {
                image = Base64.decode(encoded, Base64.DEFAULT);
            } catch (IllegalArgumentException exception) {
                throw error("INVALID_IMAGE", "The photo data is invalid.");
            }
            try {
                ImageInfo info = inspectImage(image, mimeType);
                JSObject result = performOcr(requireConfig(), requestId, image, info, control);
                if (control.cancelled.get()) throw OcrException.cancelled();
                call.resolve(result);
            } finally {
                Arrays.fill(image, (byte) 0);
            }
        });
    }

    @PluginMethod
    public void cancelExtraction(PluginCall call) {
        String requestId = call.getString("requestId");
        if (!MedicineOcrPolicy.isValidRequestId(requestId)) {
            reject(call, error("INVALID_REQUEST_ID", "The OCR request ID is invalid."));
            return;
        }
        RequestControl control = requests.get(requestId);
        if (control != null) control.cancel();
        JSObject response = new JSObject();
        response.put("requestId", requestId);
        response.put("cancelled", control != null);
        call.resolve(response);
    }

    @Override
    protected void handleOnDestroy() {
        cancelAll();
        executor.shutdownNow();
        super.handleOnDestroy();
    }

    private void showKeyDialog(PluginCall call, Activity activity, String projectId) {
        EditText input = new EditText(activity);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        input.setSingleLine(true);
        input.setImeOptions(EditorInfo.IME_ACTION_DONE);
        input.setHint("Google Cloud Vision API key");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            input.setImportantForAutofill(EditText.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        AlertDialog dialog = new AlertDialog.Builder(activity)
            .setTitle("Configure medicine OCR")
            .setMessage("Paste the restricted Google Cloud Vision API key for project " + projectId + ". The key stays encrypted on this device.")
            .setView(input)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Save", null)
            .create();
        dialog.setOnCancelListener(ignored -> reject(call, error("CANCELLED", "Key configuration was cancelled.")));
        dialog.setOnDismissListener(ignored -> input.setText(null));
        dialog.setOnShowListener(ignored -> {
            Window window = dialog.getWindow();
            if (window != null) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            dialog.getButton(DialogInterface.BUTTON_NEGATIVE).setOnClickListener(view -> {
                reject(call, error("CANCELLED", "Key configuration was cancelled."));
                dialog.dismiss();
            });
            dialog.getButton(DialogInterface.BUTTON_POSITIVE).setOnClickListener(view -> {
                String apiKey = input.getText() == null ? "" : input.getText().toString().trim();
                if (apiKey.isEmpty() || apiKey.length() > MAX_API_KEY_CHARS) {
                    input.setError("Enter the API key (maximum 512 characters).");
                    return;
                }
                try {
                    SecretConfig config = new SecretConfig(apiKey, projectId, "not-tested");
                    saveConfig(config);
                    input.setText(null);
                    call.resolve(status(config, config.checkState));
                    dialog.dismiss();
                } catch (OcrException exception) {
                    input.setText(null);
                    reject(call, exception);
                    dialog.dismiss();
                }
            });
        });
        dialog.show();
    }

    private void submit(PluginCall call, String requestId, RequestWork work) {
        RequestControl control = new RequestControl();
        if (requests.putIfAbsent(requestId, control) != null) {
            reject(call, error("DUPLICATE_REQUEST", "An OCR request with this ID is already running."));
            return;
        }
        if (requests.size() > MAX_PENDING_REQUESTS) {
            requests.remove(requestId, control);
            reject(call, error("BUSY", "Too many OCR requests are already pending."));
            return;
        }
        executor.execute(() -> {
            try {
                if (control.cancelled.get()) throw OcrException.cancelled();
                work.run(control);
            } catch (OcrException exception) {
                reject(call, exception);
            } catch (Exception exception) {
                reject(call, error("INTERNAL_ERROR", "Medicine OCR could not complete."));
            } finally {
                requests.remove(requestId, control);
            }
        });
    }

    private JSObject performOcr(SecretConfig config, String requestId, byte[] image, ImageInfo info, RequestControl control) throws OcrException {
        if (control.cancelled.get()) throw OcrException.cancelled();
        HttpsURLConnection connection = null;
        try {
            URL url = new URL("https://eu-vision.googleapis.com/v1/projects/" + config.projectId + "/locations/eu/images:annotate");
            connection = (HttpsURLConnection) url.openConnection();
            control.connection = connection;
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setRequestMethod("POST");
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("x-goog-api-key", config.apiKey);
            connection.setRequestProperty("X-Android-Package", getContext().getPackageName());
            connection.setRequestProperty("X-Android-Cert", signingCertificateSha1());
            byte[] body = requestBody(image);
            connection.setFixedLengthStreamingMode(body.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body);
            } finally {
                Arrays.fill(body, (byte) 0);
            }
            if (control.cancelled.get()) throw OcrException.cancelled();
            int status = connection.getResponseCode();
            if (status < 200 || status >= 300) throw httpError(status);
            if (connection.getContentLength() > MedicineOcrPolicy.MAX_RESPONSE_BYTES) {
                throw error("RESPONSE_TOO_LARGE", "The OCR response exceeded the safe size limit.");
            }
            byte[] response;
            try (InputStream input = connection.getInputStream()) {
                response = readBounded(input, MedicineOcrPolicy.MAX_RESPONSE_BYTES);
            }
            if (control.cancelled.get()) throw OcrException.cancelled();
            try {
                return parseResponse(requestId, image, info, response);
            } finally {
                Arrays.fill(response, (byte) 0);
            }
        } catch (OcrException exception) {
            throw exception;
        } catch (java.net.SocketTimeoutException exception) {
            throw error("TIMEOUT", "The OCR service timed out.");
        } catch (IOException exception) {
            if (control.cancelled.get()) throw OcrException.cancelled();
            throw error("NETWORK_ERROR", "The OCR service could not be reached.");
        } finally {
            control.connection = null;
            if (connection != null) connection.disconnect();
        }
    }

    private byte[] requestBody(byte[] image) throws OcrException {
        try {
            JSONObject feature = new JSONObject().put("type", "DOCUMENT_TEXT_DETECTION");
            JSONObject imageObject = new JSONObject().put("content", Base64.encodeToString(image, Base64.NO_WRAP));
            JSONObject request = new JSONObject().put("image", imageObject).put("features", new JSONArray().put(feature));
            return new JSONObject().put("requests", new JSONArray().put(request)).toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException exception) {
            throw error("INTERNAL_ERROR", "The OCR request could not be prepared.");
        }
    }

    private JSObject parseResponse(String requestId, byte[] image, ImageInfo info, byte[] bytes) throws OcrException {
        try {
            JSONObject root = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            JSONArray responses = root.optJSONArray("responses");
            if (responses == null || responses.length() != 1) throw invalidResponse();
            JSONObject response = responses.optJSONObject(0);
            if (response == null) throw invalidResponse();
            if (response.has("error")) throw error("VISION_REJECTED", "The OCR service rejected the image.");
            JSONObject annotation = response.optJSONObject("fullTextAnnotation");
            String text = annotation == null ? "" : annotation.optString("text", "");
            if (!MedicineOcrPolicy.isTextWithinLimit(text)) {
                throw error("OCR_TEXT_TOO_LARGE", "The detected text exceeded the safe size limit.");
            }
            if (!MedicineOcrPolicy.isReadableText(text)) {
                throw error("NO_READABLE_TEXT", "No readable text was found in the photo.");
            }
            JSArray lines = annotation == null ? new JSArray() : extractLines(annotation, info);
            if (lines.length() == 0) {
                throw error("NO_READABLE_TEXT", "No readable text was found in the photo.");
            }
            JSObject result = new JSObject();
            result.put("schemaVersion", SCHEMA_VERSION);
            result.put("requestId", requestId);
            result.put("imageSha256", sha256(image));
            result.put("imageWidth", info.width);
            result.put("imageHeight", info.height);
            result.put("text", text);
            result.put("lines", lines);
            return result;
        } catch (OcrException exception) {
            throw exception;
        } catch (JSONException exception) {
            throw invalidResponse();
        }
    }

    private JSArray extractLines(JSONObject annotation, ImageInfo info) throws JSONException, OcrException {
        JSArray lines = new JSArray();
        JSONArray pages = annotation.optJSONArray("pages");
        if (pages == null) return lines;
        int emittedChars = 0;
        for (int pi = 0; pi < pages.length(); pi++) {
            JSONObject page = pages.optJSONObject(pi);
            JSONArray blocks = page == null ? null : page.optJSONArray("blocks");
            if (blocks == null) continue;
            for (int bi = 0; bi < blocks.length(); bi++) {
                JSONObject block = blocks.optJSONObject(bi);
                JSONArray paragraphs = block == null ? null : block.optJSONArray("paragraphs");
                if (paragraphs == null) continue;
                for (int qi = 0; qi < paragraphs.length(); qi++) {
                    JSONObject paragraph = paragraphs.optJSONObject(qi);
                    JSONArray words = paragraph == null ? null : paragraph.optJSONArray("words");
                    if (words == null) continue;
                    LineBuilder line = new LineBuilder();
                    for (int wi = 0; wi < words.length(); wi++) {
                        JSONObject word = words.optJSONObject(wi);
                        if (word == null) continue;
                        line.include(word.optJSONObject("boundingBox"), info);
                        BreakType breakType = appendWord(line.text, word);
                        if (breakType == BreakType.SPACE) line.text.append(' ');
                        if (breakType == BreakType.HYPHEN) line.text.append('-');
                        if (breakType == BreakType.HYPHEN || breakType == BreakType.LINE) {
                            emittedChars = emitLine(lines, line, emittedChars);
                            line = new LineBuilder();
                        }
                    }
                    emittedChars = emitLine(lines, line, emittedChars);
                }
            }
        }
        return lines;
    }

    private int emitLine(JSArray lines, LineBuilder line, int emittedChars) throws OcrException {
        String value = line.text.toString().trim();
        if (value.isEmpty()) return emittedChars;
        if (lines.length() >= MedicineOcrPolicy.MAX_LINES) {
            throw error("OCR_LINES_TOO_MANY", "The detected text contained too many lines.");
        }
        if (!MedicineOcrPolicy.canAppendLine(lines.length(), emittedChars, value)) {
            throw error("OCR_TEXT_TOO_LARGE", "The detected text exceeded the safe size limit.");
        }
        JSObject item = new JSObject();
        item.put("text", value);
        item.put("polygon", line.polygon());
        lines.put(item);
        return emittedChars + value.length();
    }

    private BreakType appendWord(StringBuilder output, JSONObject word) {
        JSONArray symbols = word.optJSONArray("symbols");
        BreakType detected = BreakType.NONE;
        if (symbols == null) return detected;
        for (int si = 0; si < symbols.length(); si++) {
            JSONObject symbol = symbols.optJSONObject(si);
            if (symbol == null) continue;
            output.append(symbol.optString("text", ""));
            JSONObject property = symbol.optJSONObject("property");
            JSONObject foundBreak = property == null ? null : property.optJSONObject("detectedBreak");
            String type = foundBreak == null ? "" : foundBreak.optString("type", "");
            if (type.equals("SPACE") || type.equals("SURE_SPACE")) detected = BreakType.SPACE;
            if (type.equals("HYPHEN")) detected = BreakType.HYPHEN;
            if (type.equals("EOL_SURE_SPACE") || type.equals("LINE_BREAK")) detected = BreakType.LINE;
        }
        return detected;
    }

    private ImageInfo inspectImage(byte[] image, String requestedMime) throws OcrException {
        if (image.length == 0) throw error("INVALID_IMAGE", "The photo is empty.");
        if (image.length > MedicineOcrPolicy.MAX_IMAGE_BYTES) throw error("IMAGE_TOO_LARGE", "The photo exceeds the 8 MB OCR limit.");
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(image, 0, image.length, options);
        if (options.outWidth <= 0 || options.outHeight <= 0) throw error("INVALID_IMAGE", "The photo could not be decoded.");
        long pixels = (long) options.outWidth * options.outHeight;
        if (options.outWidth > MedicineOcrPolicy.MAX_IMAGE_DIMENSION || options.outHeight > MedicineOcrPolicy.MAX_IMAGE_DIMENSION
            || pixels > MedicineOcrPolicy.MAX_IMAGE_PIXELS) {
            throw error("IMAGE_DIMENSIONS_TOO_LARGE", "The photo dimensions exceed the OCR limit.");
        }
        if (!MedicineOcrPolicy.normalizeMimeType(options.outMimeType).equals(requestedMime)) {
            throw error("MIME_MISMATCH", "The photo type does not match its contents.");
        }
        return new ImageInfo(options.outWidth, options.outHeight);
    }

    private byte[] testImage() throws OcrException {
        Bitmap bitmap = Bitmap.createBitmap(1024, 256, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(bitmap);
        canvas.drawColor(Color.WHITE);
        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
        paint.setColor(Color.BLACK);
        paint.setTextSize(64f);
        paint.setFakeBoldText(true);
        canvas.drawText(TEST_TEXT, 46f, 148f, paint);
        try (ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, output)) {
                throw error("INTERNAL_ERROR", "The connection test image could not be prepared.");
            }
            return output.toByteArray();
        } catch (IOException exception) {
            throw error("INTERNAL_ERROR", "The connection test image could not be prepared.");
        } finally {
            bitmap.recycle();
        }
    }

    private SecretConfig requireConfig() throws OcrException {
        SecretConfig config = loadConfig();
        if (config == null) throw error("NOT_CONFIGURED", "Configure a Google Cloud Vision API key first.");
        return config;
    }

    private SecretConfig loadConfig() throws OcrException {
        synchronized (configLock) {
            AtomicFile file = configFile();
            if (!file.getBaseFile().exists()) return null;
            byte[] encrypted;
            try (FileInputStream input = file.openRead()) {
                encrypted = readBounded(input, 4096);
            } catch (Exception exception) {
                throw error("CONFIGURATION_ERROR", "The encrypted OCR configuration could not be read.");
            }
            try {
                ByteBuffer buffer = ByteBuffer.wrap(encrypted);
                int version = buffer.get() & 0xff;
                int ivLength = buffer.get() & 0xff;
                if (version != SCHEMA_VERSION || ivLength != IV_BYTES || buffer.remaining() <= ivLength) {
                    throw error("CONFIGURATION_ERROR", "The encrypted OCR configuration is invalid.");
                }
                byte[] iv = new byte[ivLength];
                buffer.get(iv);
                byte[] ciphertext = new byte[buffer.remaining()];
                buffer.get(ciphertext);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, secretKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
                cipher.updateAAD(configAad());
                byte[] plaintext = cipher.doFinal(ciphertext);
                try {
                    JSONObject json = new JSONObject(new String(plaintext, StandardCharsets.UTF_8));
                    String apiKey = json.optString("apiKey", "");
                    String projectId = json.optString("projectId", "");
                    String state = json.optString("checkState", "not-tested");
                    if (apiKey.isEmpty() || apiKey.length() > MAX_API_KEY_CHARS || !MedicineOcrPolicy.isValidProjectId(projectId)) {
                        throw error("CONFIGURATION_ERROR", "The encrypted OCR configuration is invalid.");
                    }
                    if (!state.equals("not-tested") && !state.equals("ok") && !state.equals("failed")) state = "not-tested";
                    return new SecretConfig(apiKey, projectId, state);
                } finally {
                    Arrays.fill(plaintext, (byte) 0);
                }
            } catch (OcrException exception) {
                throw exception;
            } catch (Exception exception) {
                throw error("CONFIGURATION_ERROR", "The encrypted OCR configuration could not be opened.");
            } finally {
                Arrays.fill(encrypted, (byte) 0);
            }
        }
    }

    private void saveConfig(SecretConfig config) throws OcrException {
        synchronized (configLock) {
            byte[] plaintext = null;
            byte[] ciphertext = null;
            FileOutputStream output = null;
            AtomicFile file = configFile();
            try {
                JSONObject json = new JSONObject();
                json.put("apiKey", config.apiKey);
                json.put("projectId", config.projectId);
                json.put("checkState", config.checkState);
                plaintext = json.toString().getBytes(StandardCharsets.UTF_8);
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, secretKey());
                cipher.updateAAD(configAad());
                byte[] iv = cipher.getIV();
                if (iv == null || iv.length != IV_BYTES) throw new Exception();
                ciphertext = cipher.doFinal(plaintext);
                ByteBuffer envelope = ByteBuffer.allocate(2 + iv.length + ciphertext.length);
                envelope.put((byte) SCHEMA_VERSION).put((byte) iv.length).put(iv).put(ciphertext);
                output = file.startWrite();
                output.write(envelope.array());
                file.finishWrite(output);
                output = null;
            } catch (Exception exception) {
                if (output != null) file.failWrite(output);
                throw error("CONFIGURATION_ERROR", "The OCR key could not be encrypted on this device.");
            } finally {
                if (plaintext != null) Arrays.fill(plaintext, (byte) 0);
                if (ciphertext != null) Arrays.fill(ciphertext, (byte) 0);
            }
        }
    }

    private void updateCheckState(SecretConfig testedConfig, String state) throws OcrException {
        synchronized (configLock) {
            SecretConfig current = loadConfig();
            if (current != null
                && current.projectId.equals(testedConfig.projectId)
                && current.apiKey.equals(testedConfig.apiKey)) {
                saveConfig(new SecretConfig(current.apiKey, current.projectId, state));
            }
        }
    }

    private SecretKey secretKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    private void deleteConfigAndKey() throws OcrException {
        synchronized (configLock) {
            try {
                configFile().delete();
                KeyStore store = KeyStore.getInstance(KEYSTORE);
                store.load(null);
                if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
            } catch (Exception exception) {
                throw error("CONFIGURATION_ERROR", "The encrypted OCR configuration could not be removed.");
            }
        }
    }

    private AtomicFile configFile() {
        return new AtomicFile(new File(getContext().getNoBackupFilesDir(), CONFIG_FILE));
    }

    private byte[] configAad() {
        return (getContext().getPackageName() + ":medicine-ocr:v1").getBytes(StandardCharsets.UTF_8);
    }

    private JSObject status(SecretConfig config, String state) throws OcrException {
        JSObject output = new JSObject();
        output.put("schemaVersion", SCHEMA_VERSION);
        output.put("configured", config != null);
        output.put("projectId", config == null ? JSONObject.NULL : config.projectId);
        output.put("checkState", state);
        output.put("androidPackage", getContext().getPackageName());
        output.put("androidCertSha1", signingCertificateSha1());
        return output;
    }

    @SuppressWarnings("deprecation")
    private String signingCertificateSha1() throws OcrException {
        try {
            PackageManager manager = getContext().getPackageManager();
            String packageName = getContext().getPackageName();
            Signature[] signatures;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                PackageInfo info = manager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES);
                signatures = info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners();
            } else {
                signatures = manager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures;
            }
            if (signatures == null || signatures.length == 0) throw new Exception();
            return hex(MessageDigest.getInstance("SHA-1").digest(signatures[0].toByteArray())).toUpperCase(Locale.ROOT);
        } catch (Exception exception) {
            throw error("CONFIGURATION_ERROR", "The Android signing certificate could not be read.");
        }
    }

    private static byte[] readBounded(InputStream input, int limit) throws IOException, OcrException {
        ByteArrayOutputStream output = new ByteArrayOutputStream(Math.min(limit, 16384));
        byte[] buffer = new byte[8192];
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > limit) throw error("RESPONSE_TOO_LARGE", "The OCR response exceeded the safe size limit.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static OcrException httpError(int status) {
        if (status == 401 || status == 403) return error("AUTH_ERROR", "The OCR credentials or Android restrictions were rejected.");
        if (status == 429) return error("RATE_LIMITED", "The OCR service rate limit was reached.");
        if (status >= 500) return error("SERVICE_UNAVAILABLE", "The OCR service is temporarily unavailable.");
        return error("REQUEST_REJECTED", "The OCR service rejected the request.");
    }

    private static OcrException invalidResponse() {
        return error("INVALID_RESPONSE", "The OCR service returned an invalid response.");
    }

    private static OcrException error(String code, String message) {
        return new OcrException(code, message);
    }

    private static int encodedLengthLimit() {
        return ((MedicineOcrPolicy.MAX_IMAGE_BYTES + 2) / 3) * 4 + 8192;
    }

    private static String normalized(String value) {
        return value == null ? "" : value.replaceAll("\\s+", " ").trim().toUpperCase(Locale.ROOT);
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }

    private static String sha256(byte[] value) throws OcrException {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(value));
        } catch (Exception exception) {
            throw error("INTERNAL_ERROR", "The photo fingerprint could not be created.");
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder output = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) output.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return output.toString();
    }

    private static void reject(PluginCall call, OcrException exception) {
        call.reject(exception.safeMessage, exception.code);
    }

    private void cancelAll() {
        for (RequestControl control : requests.values()) control.cancel();
    }

    private enum BreakType { NONE, SPACE, HYPHEN, LINE }

    private interface RequestWork {
        void run(RequestControl control) throws Exception;
    }

    private static final class RequestControl {
        final AtomicBoolean cancelled = new AtomicBoolean(false);
        volatile HttpsURLConnection connection;

        void cancel() {
            cancelled.set(true);
            HttpsURLConnection active = connection;
            if (active != null) active.disconnect();
        }
    }

    private static final class SecretConfig {
        final String apiKey;
        final String projectId;
        final String checkState;

        SecretConfig(String apiKey, String projectId, String checkState) {
            this.apiKey = apiKey;
            this.projectId = projectId;
            this.checkState = checkState;
        }
    }

    private static final class ImageInfo {
        final int width;
        final int height;

        ImageInfo(int width, int height) {
            this.width = width;
            this.height = height;
        }
    }

    private static final class LineBuilder {
        final StringBuilder text = new StringBuilder();
        int minX = Integer.MAX_VALUE;
        int minY = Integer.MAX_VALUE;
        int maxX = Integer.MIN_VALUE;
        int maxY = Integer.MIN_VALUE;

        boolean invalid;

        void include(JSONObject box, ImageInfo image) {
            JSONArray vertices = box == null ? null : box.optJSONArray("vertices");
            if (vertices == null || vertices.length() != 4) {
                invalid = true;
                return;
            }
            for (int i = 0; i < vertices.length(); i++) {
                JSONObject vertex = vertices.optJSONObject(i);
                if (vertex == null) {
                    invalid = true;
                    continue;
                }
                int x = vertex.optInt("x", 0);
                int y = vertex.optInt("y", 0);
                if (!MedicineOcrPolicy.isValidCoordinate(x, y, image.width, image.height)) invalid = true;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }

        JSArray polygon() throws OcrException {
            if (invalid || minX == Integer.MAX_VALUE || minY == Integer.MAX_VALUE) throw invalidResponse();
            int left = minX == Integer.MAX_VALUE ? 0 : minX;
            int top = minY == Integer.MAX_VALUE ? 0 : minY;
            int right = maxX == Integer.MIN_VALUE ? left : maxX;
            int bottom = maxY == Integer.MIN_VALUE ? top : maxY;
            JSArray points = new JSArray();
            points.put(point(left, top));
            points.put(point(right, top));
            points.put(point(right, bottom));
            points.put(point(left, bottom));
            return points;
        }

        private JSObject point(int x, int y) {
            JSObject point = new JSObject();
            point.put("x", x);
            point.put("y", y);
            return point;
        }
    }

    private static final class OcrException extends Exception {
        final String code;
        final String safeMessage;

        OcrException(String code, String safeMessage) {
            super(code);
            this.code = code;
            this.safeMessage = safeMessage;
        }

        static OcrException cancelled() {
            return error("CANCELLED", "The OCR request was cancelled.");
        }
    }
}
