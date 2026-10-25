# Native Custom Match result reporting

Status: implemented, 25 October 2026. Automated checks and private builds passed; real gameplay verification belongs to the user.

## Intent and scope

When an RA2 or Yuri's Revenge Internet Custom Match ends, send the game's
result information to RA2Web and save it as match history. The user selected
history only: no changes to rankings, MMR, ladder points or ranked eligibility.
The user will do real gameplay testing. Automated verification here is limited
to COM, frontend transport, packet decoding and server persistence tests.

Use the current checkout and preserve unrelated work. Keep generated game data,
binary dumps and lifted code out of version control. No public deployment.

## Approaches

Use the native `INetUtil::RequestGameresSend` result packet. This is the
recommended approach because the game already assembles per-player results and
statistics; it preserves information that reconstructing results from the score
screen would lose. Scraping game memory or interpreting opaque gameplay relay
traffic would add edition-dependent assumptions and is rejected.

Reuse the server's storage and match-history conventions. Keep native Custom
Match ingestion separate from the existing ranked `/wgameres/{sku}` validation
path so it cannot accidentally award points or weaken ranked validation.
The particular HTTP route name and internal storage layout are builder choices.

## Existing evidence

- WOLAPI type library: `INetUtil` slot 3 is
  `RequestGameresSend(host, port, data, length)`. `INetUtilEvent` slot 5 is
  `OnGameresSent(HRESULT)`. `IChat` slot 30 is `RequestGameEnd()`.
- These bridge methods currently return `E_NOTIMPL`.
- YR's native report builder at 0x6c6f50 includes numeric `IDNO` (the shortened
  native game number) and `GSKU`, `TRNY`, `OOSY`, `FINI`, and player fields.
  This is not interchangeable with the RA2Web client's string `GMID` format.
- The browser already retains the full STARTG game ID. Server instances retain
  their fixed roster. The native relay forwards opaque datagrams only.
- Server storage already supports unscored match archives, while the ranked
  endpoint requires a ranked instance and tournament report.

## Proposed flow

1. Implement the native result-send method with the original stack ABI. Copy
   bounded binary data before returning, since the game owns the buffer. Send it
   to a new browser module callback; do not use the supplied legacy host/port as
   a credential or fetch destination.
2. The browser associates each report with an immutable STARTG context (full
   game ID, native game number, edition). Keep that context through PART, lobby
   return and relay shutdown long enough to finish submission. A later match or
   login must not relabel an earlier result or receive its completion callback.
3. Submit to the trusted operator HTTP base using the existing authenticated
   session. Preserve context-path support. Use a bounded timeout; report success
   only after server acceptance. The native result callback runs through its
   message pump, on the game thread, and targets the correct INetUtil sink.
   Failures must complete with a failure HRESULT and remain visible in logs.
   Retries, if implemented, are bounded and idempotent.
4. Server checks authenticated identity, payload size and field bounds, known
   match context, native ID/edition and the match roster. The authenticated
   reporter must belong to the server roster. Parse native field types explicitly;
   never treat numeric `IDNO` as the globally unique full game ID.
5. Persist each player's report idempotently and retain its original packet and
   decoded information. Save outcomes, duration, map, completion/desync flags and
   available per-player statistics. Mark data as client-reported. Preserve
   conflicting reports and incomplete outcomes rather than manufacturing a
   trusted winner. Existing match-history/admin reads should expose the saved
   summary without changing standings or replacing a ranked record.
6. Implement `RequestGameEnd` as a separate lifecycle notification if native
   callers need it. It must not fabricate a result, erase a queued report or stop
   the relay during match startup. Preserve a server report window after end.

## Failure and lifecycle rules

- Reject truncated fields, impossible lengths, invalid types and oversized data.
- Repeated submissions by the same reporter do not create duplicate history.
  Preserve distinct terminal reports and audit discrepancies from other players.
- A native resign/leave report may precede the other player's final report;
  an unfinished report must not overwrite a terminal result.
- AI and observer records must be distinguished from authenticated human roster
  membership; confirm native naming/indexing before applying roster checks.
- Do not persist passwords, session tokens or STARTG tickets with result packets.
  Inspect native fields for credential material and redact it before archival.
- Lobby cleanup and report submission have independent lifetimes. A slow server
  must not freeze score continuation or return to Custom Match.

## Validation and completion

Add failing tests before implementation for binary copying and asynchronous COM
completion, success/failure HTTP submission with configured prefixes, stale
completion isolation, RA2/YR native field decoding, bad data, authentication,
roster/ID mismatch, duplicates, conflicting/incomplete results, persistence and
unchanged ladder standings. Verify both supported storage backends where touched.
Use small synthetic protocol fixtures in version control, not extracted game data.

Build both local editions if the bridge changes, without replacing another task's
live assets. Document manual steps for the user to end a match and inspect the
saved history. Report automated checks separately from user-owned gameplay
verification; do not claim an end-to-end pass without that evidence.

## Remaining investigation

Confirm the RA2 report-builder equivalent, native binary field types/padding and
per-player keys, the report enqueue conditions for unranked Custom Match, and
whether end notification is actually called. If a native hook is required, make
the smallest browser-only patch at the existing report boundary, document its
evidence, and preserve original offline/LAN behavior. No score-screen UI redesign
or ranked protocol integration is included.
