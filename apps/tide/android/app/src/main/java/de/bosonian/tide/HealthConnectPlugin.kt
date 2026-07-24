package de.bosonian.tide

// ARCHITECTURE RULE (same as apps/runway's WifiBridgePlugin.java/
// BluetoothBridgePlugin.java): this plugin moves data across the JS<->native
// boundary and nothing more. Which record types to ask Health Connect for,
// how a permission alias maps to a UI scope name, and — critically — the
// dedup/cursor/body-fat-correlation logic all live in TypeScript
// (src/native/healthConnect.ts, src/lib/healthSync.ts); this file only
// knows how to talk to the androidx.health.connect:connect-client library.
//
// WHY KOTLIN, not Java (this app's only other native plugin file so far —
// there are none yet, this is the first — would otherwise have been Java to
// match MainActivity.java): Health Connect's entire client API
// (HealthConnectClient.readRecords, .aggregate, PermissionController's own
// suspend functions) is written as Kotlin SUSPEND functions, with no
// official Java-friendly (Guava ListenableFuture / RxJava) adapter artifact
// published alongside connect-client. Calling a suspend function from Java
// means hand-writing a raw kotlin.coroutines.Continuation implementation —
// technically possible, but exactly the kind of "harder to verify by
// reading, easier to get subtly wrong" tradeoff CLAUDE.md's honesty rule
// warns against, for a plugin that already can't be compiled or run in this
// environment (see this increment's own report/CHANGELOG entry — verified
// by reading only). Writing this ONE file in Kotlin instead, and calling
// its suspend functions the normal Kotlin way inside a CoroutineScope, is
// the more honest choice: less code, more idiomatic, and the actual
// documented way every Health Connect codelab/sample shows this being done.
// android/build.gradle and app/build.gradle's own comments cover exactly
// what enabling Kotlin in this previously-all-Java Gradle project required.
//
// PERMISSION SHAPE (the other piece worth stating precisely, mirroring
// BluetoothBridgePlugin.java's own header comment on ITS unusual permission
// shape): Health Connect permissions — android.permission.health.READ_WEIGHT
// and friends — are declared in AndroidManifest.xml but are NOT ordinary
// Android runtime (dangerous) permissions. `ContextCompat.checkSelfPermission`
// and `ActivityCompat.requestPermissions` — the mechanism Capacitor's own
// `@Permission`/`@PermissionCallback`/`getPermissionState` machinery is built
// on — do not apply to them at all. Health Connect instead uses its own
// `PermissionController.createRequestPermissionResultContract()`, an
// `ActivityResultContract<Set<String>, Set<String>>` that launches Health
// Connect's OWN consent screen. This plugin therefore registers that
// contract directly against `bridge.registerForActivityResult` (a generic
// method the Bridge class exposes for exactly this — see
// node_modules/@capacitor/android's Bridge.java) inside `load()`, rather
// than using `@Permission`/`@PermissionCallback` at all — this class
// declares NO `permissions` on its `@CapacitorPlugin` annotation, because
// there is no Capacitor-alias-shaped permission here to declare.

import androidx.activity.result.ActivityResultLauncher
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.BodyFatRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "HealthConnect")
class HealthConnectPlugin : Plugin() {

    // One background scope for every suspend call this plugin makes,
    // cancelled in handleOnDestroy() below so an in-flight read doesn't
    // outlive the Activity that started it. SupervisorJob so one failed
    // child coroutine (a single readWeight call throwing) can never cancel
    // ITS SIBLINGS sharing this scope — each PluginMethod's own try/catch
    // is still what turns that failure into a resolved empty shape (see
    // each read method below); this is just about the scope's lifecycle,
    // not error handling.
    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    // The four read scopes this plugin ever asks for — every one of them
    // declared in AndroidManifest.xml too (both places have to agree, or
    // Health Connect silently can't grant a permission this list requests).
    private val weightPermission = HealthPermission.getReadPermission(WeightRecord::class)
    private val bodyFatPermission = HealthPermission.getReadPermission(BodyFatRecord::class)
    private val stepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    private val activeEnergyPermission = HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class)
    private val requiredPermissions: Set<String> by lazy {
        setOf(weightPermission, bodyFatPermission, stepsPermission, activeEnergyPermission)
    }

    // Registered once, in load() below (see that method's own comment for
    // the timing this relies on). launch()'d from requestHealthConnectPermissions
    // and resolved from the callback registered alongside it.
    private lateinit var permissionLauncher: ActivityResultLauncher<Set<String>>

    // The PluginCall a requestHealthConnectPermissions() invocation is
    // waiting on, saved via bridge.saveCall (so it survives the round trip
    // through Health Connect's own consent Activity) and looked back up by
    // this id when the launcher's callback fires. Same "stash an id, look
    // it back up later" shape Capacitor's own Plugin.startActivityForResult
    // uses internally for its generic ActivityCallback mechanism (see
    // node_modules/@capacitor/android's Plugin.java) — this plugin can't
    // reuse that mechanism directly because it needs a DIFFERENT
    // ActivityResultContract (Health Connect's own permission contract, not
    // Capacitor's built-in StartActivityForResult/RequestMultiplePermissions
    // pair — see this file's own header comment), so it registers and
    // tracks its own launcher/call-id pair the same way, by hand.
    private var pendingPermissionCallId: String? = null

    /**
     * `bridge.registerForActivityResult` MUST run before the hosting
     * Activity reaches STARTED — same timing constraint Capacitor's own
     * `Plugin.initializeActivityLaunchers()` relies on for its
     * `@PermissionCallback`/`@ActivityCallback` launchers (see
     * node_modules/@capacitor/android's PluginHandle.java:
     * `instance.load(); instance.initializeActivityLaunchers();`, both
     * called from Bridge construction inside `BridgeActivity.onCreate()`,
     * before `onStart()`). `load()` runs strictly before that sibling call,
     * so registering here is exactly as safe/early as Capacitor's own
     * mechanism — this is not a special case, just the same rule applied to
     * a launcher this plugin registers by hand instead of via annotation.
     */
    override fun load() {
        permissionLauncher = bridge.registerForActivityResult(
            PermissionController.createRequestPermissionResultContract()
        ) { grantedPermissions: Set<String> ->
            val callId = pendingPermissionCallId
            pendingPermissionCallId = null
            val call = if (callId != null) bridge.getSavedCall(callId) else null
            if (call != null) {
                call.resolve(permissionResult(grantedPermissions))
                bridge.releaseCall(call)
            }
            // call == null: the Activity was recreated (rotation, process
            // death) between the request and the result and lost the saved
            // call — nothing left to resolve. Not expected in practice
            // (Tide is portrait-locked per its own manifest configChanges),
            // but there is no PluginCall left to report an error TO in this
            // case, so silently dropping it (rather than throwing from
            // inside an ActivityResultCallback, which would crash the app)
            // is the only sound option.
        }
    }

    override fun handleOnDestroy() {
        pluginScope.cancel()
    }

    /**
     * Resolves `{ available: 'installed' | 'not_installed' | 'unsupported' }`
     * — never throws, never rejects, no coroutine needed (getSdkStatus is a
     * plain synchronous call). See native/healthConnect.ts's own doc
     * comment on this exact three-way mapping.
     *
     * `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED` maps to `'not_installed'`,
     * not some fourth "needs update" state — despite its name, Health
     * Connect's own documentation describes this status as covering BOTH
     * "the provider app isn't installed at all" and "it's installed but out
     * of date"; either way the correct call-to-action is identical (go to
     * the Play Store), so collapsing them to one Settings message is
     * accurate, not a simplification that loses information Settings would
     * otherwise act on differently.
     */
    @PluginMethod
    fun isAvailable(call: PluginCall) {
        val status = HealthConnectClient.getSdkStatus(context)
        val available = when (status) {
            HealthConnectClient.SDK_AVAILABLE -> "installed"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "not_installed"
            else -> "unsupported" // SDK_UNAVAILABLE
        }
        val result = JSObject()
        result.put("available", available)
        call.resolve(result)
    }

    /**
     * Named `requestHealthConnectPermissions`, deliberately NOT
     * `requestPermissions` — see this file's own header comment on why
     * reusing that name would risk colliding with `Plugin`'s own inherited
     * `@PluginMethod requestPermissions(PluginCall)`, which drives an
     * entirely different (and here, inapplicable) permission mechanism.
     * Launches Health Connect's consent screen for all four scopes at once
     * (a partial grant is still useful — see native/healthConnect.ts's own
     * comment on why Settings treats it as "connected" rather than
     * all-or-nothing) and resolves once the user returns from it. Only ever
     * called from Settings' explicit "Connect health data" tap — never from
     * a passive path — same no-ambush discipline every lazy permission in
     * this monorepo follows.
     */
    @PluginMethod
    fun requestHealthConnectPermissions(call: PluginCall) {
        pendingPermissionCallId = call.callbackId
        bridge.saveCall(call)
        permissionLauncher.launch(requiredPermissions)
    }

    private fun permissionResult(grantedPermissions: Set<String>): JSObject {
        val result = JSObject()
        result.put("granted", grantedPermissions.containsAll(requiredPermissions))
        val scopes = JSArray()
        for (permission in grantedPermissions) {
            scopes.put(scopeName(permission))
        }
        result.put("grantedScopes", scopes)
        return result
    }

    private fun scopeName(permission: String): String = when (permission) {
        weightPermission -> "weight"
        bodyFatPermission -> "bodyFat"
        stepsPermission -> "steps"
        activeEnergyPermission -> "activeEnergy"
        else -> permission // unreachable given requiredPermissions above; defensive, not a crash
    }

    /**
     * `client == null` (SDK not available) OR any thrown exception (most
     * commonly: the specific permission this call needs was never granted)
     * both resolve the SAME empty shape — "resolve a shape, never throw,
     * empty on missing permission" idiom, same contract WifiBridgePlugin.java's
     * getCurrentSsid documents for Runway. healthSync.ts treats an empty
     * read as "nothing new this sync", never as an error worth surfacing.
     */
    @PluginMethod
    fun readWeight(call: PluginCall) {
        val sinceMs = call.getLong("sinceMs", 0L)
        pluginScope.launch {
            val result = JSObject()
            val records = JSArray()
            try {
                val client = healthConnectClientOrNull()
                if (client != null) {
                    val response = client.readRecords(
                        ReadRecordsRequest(WeightRecord::class, timeRangeFilter = TimeRangeFilter.after(Instant.ofEpochMilli(sinceMs)))
                    )
                    for (record in response.records) {
                        val entry = JSObject()
                        entry.put("atMs", record.time.toEpochMilli())
                        entry.put("weightKg", record.weight.inKilograms)
                        records.put(entry)
                    }
                }
            } catch (e: Exception) {
                // records stays whatever was built before the throw
                // (normally empty) — see this method's own doc comment.
            }
            result.put("records", records)
            call.resolve(result)
        }
    }

    /** Same contract as readWeight, for BodyFatRecord. */
    @PluginMethod
    fun readBodyFat(call: PluginCall) {
        val sinceMs = call.getLong("sinceMs", 0L)
        pluginScope.launch {
            val result = JSObject()
            val records = JSArray()
            try {
                val client = healthConnectClientOrNull()
                if (client != null) {
                    val response = client.readRecords(
                        ReadRecordsRequest(BodyFatRecord::class, timeRangeFilter = TimeRangeFilter.after(Instant.ofEpochMilli(sinceMs)))
                    )
                    for (record in response.records) {
                        val entry = JSObject()
                        entry.put("atMs", record.time.toEpochMilli())
                        entry.put("bodyFatPct", record.percentage.value)
                        records.put(entry)
                    }
                }
            } catch (e: Exception) {
                // see readWeight's own comment
            }
            result.put("records", records)
            call.resolve(result)
        }
    }

    /**
     * Resolves `{ days: [{date, steps}] }` — per-CALENDAR-DAY totals, not
     * raw StepsRecord rows. Aggregation is done HERE, in this plugin, over
     * raw per-record reads, rather than via HealthConnectClient's own
     * `aggregateGroupByPeriod` API: the raw-read-then-bucket approach uses
     * only the same `readRecords`/`ReadRecordsRequest` shape `readWeight`/
     * `readBodyFat` already use above, which this increment can verify by
     * reading against those two working examples; `aggregateGroupByPeriod`
     * is a separate, more elaborate API surface (its own request/response
     * classes) this code has no comparable reference point for, in an
     * environment that can't compile either approach to find out which one
     * is right. Trades a slightly larger data pull (every raw record, not a
     * pre-aggregated sum) for a shape this increment is actually confident
     * is correct — worth revisiting once real-device testing confirms the
     * simpler approach works, if the raw-record volume ever becomes a real
     * concern (a watch's step data is usually chunked into a manageable
     * number of records per day, not one record per step).
     */
    @PluginMethod
    fun readSteps(call: PluginCall) {
        val sinceMs = call.getLong("sinceMs", 0L)
        pluginScope.launch {
            val result = JSObject()
            val days = JSArray()
            try {
                val client = healthConnectClientOrNull()
                if (client != null) {
                    val response = client.readRecords(
                        ReadRecordsRequest(StepsRecord::class, timeRangeFilter = TimeRangeFilter.after(Instant.ofEpochMilli(sinceMs)))
                    )
                    val zone = ZoneId.systemDefault()
                    val perDay = LinkedHashMap<String, Long>()
                    for (record in response.records) {
                        // Bucketed by the record's START time's local
                        // calendar day. A record spanning midnight (rare —
                        // a watch's sync interval is normally much shorter
                        // than a day) attributes its whole count to the day
                        // it started on rather than splitting it — an
                        // accepted simplification for a signal this app
                        // only ever shows as "steps today", never audits to
                        // the exact step.
                        val date = LocalDateTime.ofInstant(record.startTime, zone).toLocalDate().toString()
                        perDay[date] = (perDay[date] ?: 0L) + record.count
                    }
                    for ((date, steps) in perDay) {
                        val entry = JSObject()
                        entry.put("date", date)
                        entry.put("steps", steps)
                        days.put(entry)
                    }
                }
            } catch (e: Exception) {
                // see readWeight's own comment
            }
            result.put("days", days)
            call.resolve(result)
        }
    }

    /** Same per-day-bucketing approach as readSteps above (see that
     * method's own comment on the aggregation-shape tradeoff), for
     * ActiveCaloriesBurnedRecord. */
    @PluginMethod
    fun readActiveEnergy(call: PluginCall) {
        val sinceMs = call.getLong("sinceMs", 0L)
        pluginScope.launch {
            val result = JSObject()
            val days = JSArray()
            try {
                val client = healthConnectClientOrNull()
                if (client != null) {
                    val response = client.readRecords(
                        ReadRecordsRequest(
                            ActiveCaloriesBurnedRecord::class,
                            timeRangeFilter = TimeRangeFilter.after(Instant.ofEpochMilli(sinceMs)),
                        )
                    )
                    val zone = ZoneId.systemDefault()
                    val perDay = LinkedHashMap<String, Double>()
                    for (record in response.records) {
                        val date = LocalDateTime.ofInstant(record.startTime, zone).toLocalDate().toString()
                        perDay[date] = (perDay[date] ?: 0.0) + record.energy.inKilocalories
                    }
                    for ((date, kcal) in perDay) {
                        val entry = JSObject()
                        entry.put("date", date)
                        entry.put("activeKcal", kcal)
                        days.put(entry)
                    }
                }
            } catch (e: Exception) {
                // see readWeight's own comment
            }
            result.put("days", days)
            call.resolve(result)
        }
    }

    /** `null` when Health Connect's SDK isn't available on this device at
     * all (see isAvailable's own doc comment on the three-way status) — the
     * FOUR read methods above all treat that the same as any other read
     * failure (a caught exception), resolving an empty shape either way.
     * `getOrCreate` itself is a plain (non-suspend) factory call, safe from
     * any thread. */
    private fun healthConnectClientOrNull(): HealthConnectClient? {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return null
        return HealthConnectClient.getOrCreate(context)
    }
}
