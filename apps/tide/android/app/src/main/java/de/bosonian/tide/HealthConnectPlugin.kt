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
import androidx.health.connect.client.records.metadata.DataOrigin
import androidx.health.connect.client.request.AggregateGroupByPeriodRequest
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.Period
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
        // getLong is @Nullable even WITH a default (Capacitor returns the
        // default only when the key is absent AND the present value is a Long;
        // a JS number that deserialized to something other than Long — or a
        // missing key — still yields a Java null through the boxed Long return
        // type, which Kotlin sees as Long?). Instant.ofEpochMilli wants a
        // primitive long, so coalesce to 0L. Java never caught this (platform
        // types); Kotlin's null-checking is exactly why it surfaced at compile
        // time here rather than as a runtime NPE on-device.
        val sinceMs = call.getLong("sinceMs", 0L) ?: 0L
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
        // getLong is @Nullable even WITH a default (Capacitor returns the
        // default only when the key is absent AND the present value is a Long;
        // a JS number that deserialized to something other than Long — or a
        // missing key — still yields a Java null through the boxed Long return
        // type, which Kotlin sees as Long?). Instant.ofEpochMilli wants a
        // primitive long, so coalesce to 0L. Java never caught this (platform
        // types); Kotlin's null-checking is exactly why it surfaced at compile
        // time here rather than as a runtime NPE on-device.
        val sinceMs = call.getLong("sinceMs", 0L) ?: 0L
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
     * Resolves `{ days: [{date, steps}] }` — per-CALENDAR-DAY totals in the
     * device's local time zone.
     *
     * FIELD FIX (0.5.2 — issue #18, "steps from watch are shown tripled"):
     * this used to `readRecords` every raw StepsRecord and SUM them per day.
     * On a real device that triple-counts. Samsung Health exposes the same
     * steps from several data origins at once — the Galaxy Watch, the phone's
     * own pedometer, and Samsung Health's own aggregate — and Health Connect
     * stores each origin's records separately, so summing all of them counts
     * every step two or three times over. This is exactly the risk the
     * 0.3.0 version of this comment flagged ("worth revisiting once
     * real-device testing confirms the simpler approach works"); it did not.
     *
     * The fix is Health Connect's aggregation API — `aggregateGroupByPeriod`
     * with `StepsRecord.COUNT_TOTAL` — which de-duplicates overlapping
     * records across data origins using Health Connect's own source-priority
     * rules and returns one correct total per day. That is the exact problem
     * this API exists to solve. As a bonus it splits a midnight-spanning
     * record at the day boundary (the old raw approach attributed the whole
     * record to its start day), so the per-day numbers are more correct too.
     *
     * FIELD FIX (0.6.0 — issue #20, "steps shown as ~11k, Samsung Health says
     * 6714"): 0.5.2's fix above de-duplicates records that OVERLAP within a
     * single data origin (the watch reporting the same walk twice), but two
     * INDEPENDENT origins — Samsung Health's own aggregate AND the phone's
     * separate pedometer app, say — both legitimately hold non-overlapping
     * StepsRecords for the same walk, and `aggregateGroupByPeriod` sums
     * across origins by design, not just within one. There is no reliable
     * way to auto-detect which origin is "the real one" (Settings.tsx's own
     * comment on this decision explains why this plugin does not try to
     * guess). The `dataOriginFilter` this call now accepts is the fix: an
     * OPTIONAL `packageNames` option scopes the aggregate to exactly the
     * origins the user picked in Settings' "Step source" picker (see
     * `readStepSources` below, which is what powers that picker's per-source
     * breakdown). See `dataOriginFilterFrom`'s own comment for why an absent
     * or empty list means "no filter" — Health Connect's own default and
     * exactly today's (over-counting) behaviour, preserved for anyone who
     * hasn't picked a source yet.
     */
    @PluginMethod
    fun readSteps(call: PluginCall) {
        val sinceMs = call.getLong("sinceMs", 0L) ?: 0L
        val dataOriginFilter = dataOriginFilterFrom(call)
        pluginScope.launch {
            val result = JSObject()
            val days = JSArray()
            try {
                val client = healthConnectClientOrNull()
                if (client != null) {
                    val (startLocal, endLocal) = localAggregateRange(sinceMs)
                    if (startLocal.isBefore(endLocal)) {
                        val response = client.aggregateGroupByPeriod(
                            AggregateGroupByPeriodRequest(
                                metrics = setOf(StepsRecord.COUNT_TOTAL),
                                timeRangeFilter = TimeRangeFilter.between(startLocal, endLocal),
                                timeRangeSlicer = Period.ofDays(1),
                                dataOriginFilter = dataOriginFilter,
                            )
                        )
                        for (group in response) {
                            // null when a day's slice had no steps from any
                            // source — skipped, not written as a 0 row: a
                            // missing day is "no reading", not "zero steps",
                            // and healthSync.ts / formatMovementLine treat the
                            // two differently (null reads as "not yet").
                            val steps = group.result[StepsRecord.COUNT_TOTAL] ?: continue
                            val entry = JSObject()
                            entry.put("date", group.startTime.toLocalDate().toString())
                            entry.put("steps", steps)
                            days.put(entry)
                        }
                    }
                }
            } catch (e: Exception) {
                // see readWeight's own comment
            }
            result.put("days", days)
            call.resolve(result)
        }
    }

    /** Same aggregation fix and same per-day, de-duplicated-across-sources
     * shape as readSteps above (see its doc comment and issue #18), for
     * ActiveCaloriesBurnedRecord via `ACTIVE_CALORIES_TOTAL` — active energy
     * was inflated the same way raw steps were, and for the same reason. */
    @PluginMethod
    fun readActiveEnergy(call: PluginCall) {
        val sinceMs = call.getLong("sinceMs", 0L) ?: 0L
        val dataOriginFilter = dataOriginFilterFrom(call)
        pluginScope.launch {
            val result = JSObject()
            val days = JSArray()
            try {
                val client = healthConnectClientOrNull()
                if (client != null) {
                    val (startLocal, endLocal) = localAggregateRange(sinceMs)
                    if (startLocal.isBefore(endLocal)) {
                        val response = client.aggregateGroupByPeriod(
                            AggregateGroupByPeriodRequest(
                                metrics = setOf(ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL),
                                timeRangeFilter = TimeRangeFilter.between(startLocal, endLocal),
                                timeRangeSlicer = Period.ofDays(1),
                                dataOriginFilter = dataOriginFilter,
                            )
                        )
                        for (group in response) {
                            val energy = group.result[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL] ?: continue
                            val entry = JSObject()
                            entry.put("date", group.startTime.toLocalDate().toString())
                            entry.put("activeKcal", energy.inKilocalories)
                            days.put(entry)
                        }
                    }
                }
            } catch (e: Exception) {
                // see readWeight's own comment
            }
            result.put("days", days)
            call.resolve(result)
        }
    }

    /**
     * Parses `readSteps`/`readActiveEnergy`'s optional `packageNames` option
     * into the `Set<DataOrigin>` `AggregateGroupByPeriodRequest` wants.
     *
     * EMPTY SET MEANS "ALL ORIGINS" — this is Health Connect's own default
     * for `dataOriginFilter` (an unfiltered aggregate), and it is exactly
     * what `readSteps`/`readActiveEnergy` did before this option existed. So
     * an absent `packageNames` key (old JS bundle, or a caller that never
     * set a source preference — see healthSettings.ts's own comment on why
     * "unset" deliberately means "don't pick a source on the user's behalf")
     * must resolve here to `emptySet()`, not to some other "everything"
     * sentinel — any other encoding would be a second, redundant way to say
     * the same thing and a second place a bug could hide.
     *
     * `call.getArray` returning a malformed shape, or `toList()` throwing on
     * an entry it can't coerce, is caught and also treated as "no filter" —
     * a parse problem here must degrade to today's (over-counting, but
     * previously-correct-by-definition) behaviour rather than crash a read
     * that used to succeed.
     */
    private fun dataOriginFilterFrom(call: PluginCall): Set<DataOrigin> {
        val raw = call.getArray("packageNames", null) ?: return emptySet()
        return try {
            raw.toList<Any>()
                .filterIsInstance<String>()
                .map { DataOrigin(it) }
                .toSet()
        } catch (e: Exception) {
            emptySet()
        }
    }

    /**
     * Resolves `{ sources: [{packageName, steps}] }` — TODAY's
     * de-duplicated step total PER DATA ORIGIN, so Settings' "Step source"
     * picker can show the user real numbers (e.g. "Samsung Health — 6,714
     * today") instead of asking them to pick a package name blind. This is
     * the diagnostic half of the issue #20 fix (see `readSteps`'s doc
     * comment above for the bug); `readSteps`/`readActiveEnergy`'s new
     * `dataOriginFilter` is the enforcement half.
     *
     * Two-step, same local-midnight-aligned "today" as `localAggregateRange`
     * (see that function's own doc comment — this reuses it rather than
     * hand-rolling a second definition of "today" that could quietly drift
     * from it):
     *  1. `readRecords` today's raw StepsRecords just to discover which
     *     origins wrote anything — NOT paginated. `readRecords` responses
     *     are paginated in general (`response.pageToken`), but for
     *     DISCOVERING which origin package names exist over a single day,
     *     one page is enough in every realistic case; deliberately not
     *     handling `pageToken` here rather than silently claiming this list
     *     is exhaustive when it might not be on a day with an unusually
     *     large record count.
     *  2. Per discovered origin, a real `aggregate` (not a raw sum) scoped
     *     to that one origin via `dataOriginFilter` — the same
     *     de-duplication `readSteps` relies on, just narrowed to one source
     *     at a time so each row is an honest, individually-correct total.
     *
     * Same never-throw/resolve-a-shape contract as every other read method
     * in this file: any exception resolves `{sources: []}`.
     */
    @PluginMethod
    fun readStepSources(call: PluginCall) {
        pluginScope.launch {
            val result = JSObject()
            val sources = JSArray()
            try {
                val client = healthConnectClientOrNull()
                if (client != null) {
                    val (startLocal, endLocal) = localAggregateRange(Instant.now().toEpochMilli())
                    if (startLocal.isBefore(endLocal)) {
                        val discovery = client.readRecords(
                            ReadRecordsRequest(StepsRecord::class, timeRangeFilter = TimeRangeFilter.between(startLocal, endLocal))
                        )
                        val packages = discovery.records.map { it.metadata.dataOrigin.packageName }.toSortedSet()
                        for (packageName in packages) {
                            val aggregate = client.aggregate(
                                AggregateRequest(
                                    metrics = setOf(StepsRecord.COUNT_TOTAL),
                                    timeRangeFilter = TimeRangeFilter.between(startLocal, endLocal),
                                    dataOriginFilter = setOf(DataOrigin(packageName)),
                                )
                            )
                            // null = this origin wrote a record today that
                            // Health Connect's own aggregation then excluded
                            // (rare, but the aggregate and the raw discovery
                            // read are two separate calls) — skipped rather
                            // than shown as a misleading 0.
                            val steps = aggregate[StepsRecord.COUNT_TOTAL] ?: continue
                            val entry = JSObject()
                            entry.put("packageName", packageName)
                            entry.put("steps", steps)
                            sources.put(entry)
                        }
                    }
                }
            } catch (e: Exception) {
                // see readWeight's own comment
            }
            result.put("sources", sources)
            call.resolve(result)
        }
    }

    /** How far back movement aggregation looks on a sync whose cursor is
     * still at epoch — the very first sync right after connecting, when
     * healthSync.ts passes sinceMs=0. Movement is only ever shown for recent
     * days ("steps today"), never as deep history, so there is no reason to
     * slice — and emit a bucket for — every day back to 1970 (a Period slicer
     * fills the WHOLE range with buckets whether or not data exists in them).
     * 35 days comfortably covers the 3-day re-read window plus any Samsung
     * Health sync lag, while capping the slicer at 35 buckets. */
    private val MOVEMENT_MAX_BACKFILL_DAYS = 35L

    /**
     * The local `[start, end)` range for aggregateGroupByPeriod, both ends
     * snapped to LOCAL MIDNIGHT so every `Period.ofDays(1)` slice is a true
     * calendar day.
     *
     * FIELD FIX (0.5.3 — issue #19, "steps now shown as zero"): 0.5.2 built
     * this range from the raw cursor instant (`now − 3 days`, at whatever time
     * of day the last sync ran). A Period slicer starts its first bucket at
     * `start` and steps a calendar day at a time — so an unaligned start of,
     * say, 20:24 made the slice LABELLED "today" (via `startTime.toLocalDate()`
     * in readSteps) actually span 20:24 today → 20:24 tomorrow, holding only
     * the handful of steps taken after 20:24. Today's real steps, counted from
     * 00:00, sat in the PREVIOUS slice (labelled yesterday). Result: "steps
     * today" read ~0. Snapping `start` to `atStartOfDay()` fixes it; `end` is
     * the start of TOMORROW so today is always a full, correctly-labelled
     * bucket regardless of the current time.
     *
     * LOCAL LocalDateTime, not Instant: aggregateGroupByPeriod with a `Period`
     * slicer requires a local-time TimeRangeFilter — a Period is a calendar
     * unit (a day is local-midnight-to-local-midnight, not fixed hours across
     * DST), and `atStartOfDay()` resolves each boundary to the correct instant
     * even on a DST-transition day. `start` is also clamped to no earlier than
     * MOVEMENT_MAX_BACKFILL_DAYS ago (see that constant).
     */
    private fun localAggregateRange(sinceMs: Long): Pair<LocalDateTime, LocalDateTime> {
        val zone = ZoneId.systemDefault()
        val today = LocalDate.now(zone)
        val floorDate = today.minusDays(MOVEMENT_MAX_BACKFILL_DAYS)
        val requestedDate = Instant.ofEpochMilli(sinceMs).atZone(zone).toLocalDate()
        val startDate = if (requestedDate.isBefore(floorDate)) floorDate else requestedDate
        return Pair(startDate.atStartOfDay(), today.plusDays(1).atStartOfDay())
    }

    /** `null` when Health Connect's SDK isn't available on this device at
     * all (see isAvailable's own doc comment on the three-way status) — the
     * FIVE read methods above (readWeight, readBodyFat, readSteps,
     * readActiveEnergy, readStepSources) all treat that the same as any
     * other read failure (a caught exception), resolving an empty shape
     * either way. `getOrCreate` itself is a plain (non-suspend) factory
     * call, safe from any thread. */
    private fun healthConnectClientOrNull(): HealthConnectClient? {
        if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return null
        return HealthConnectClient.getOrCreate(context)
    }
}
