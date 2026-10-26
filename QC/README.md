# Quebec platform workspaces

Owner direction: QRide first, QTR second. Quebec-wide target; municipality and airport
permissions are separate evidence, not implied coverage. These private source folders
are preparation workspaces, not licensed or publicly operating services.

- `QRide/`: independent ride app, driver/admin account presentation and licensing dossier.
- `QTR/`: independent stay app, guest/host/admin presentation and licensing dossier.
- `CAPSULE-REUSE.md`: existing SYBNB modules reused or requiring a Canada adapter.
- `IMPLEMENTATION-ORDER.md`: sequential delivery milestones and acceptance evidence.

From the repository root, use `npm run qride:dev` (5190) or `npm run qtr:dev` (5191).
Build with `npm run qride:build` / `npm run qtr:build`. Each binds only to loopback.
Or use `npm --prefix QC/QRide run dev` / `npm --prefix QC/QTR run dev` with installed
root dependencies. Node 24 and the existing root lockfile apply; no new dependencies.
Existing per-app Maps settings now belong in `QC/QRide/.env.local` and
`QC/QTR/.env.local`; never commit values. App-specific cloud variable names are unchanged.

The active V6 country registry remains Syria-only. Do not set SYBNB_COUNTRY=canada
expecting these frontend folders to activate a Canadian backend. No Syria financial,
identity, recipient or customer configuration is inherited by these apps.

Store identity documents, insurance policies, applicant records and credentials in
restricted storage outside Git. Ignored `private-evidence/` is not an access-control
system. The committed dossiers contain requirements/status only, not private evidence.
See the source-backed licensing documents under each app. They are draft preparation,
not legal opinions, submitted applications or government approvals.
