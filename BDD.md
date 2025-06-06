Below is a **two-part master specification** for the *AI-Driven Policy & Safety Intelligence Pipeline* (“the tool”).
Part A enumerates every feature, the functions that live inside each feature, and **Behaviour-Driven Development (BDD) usage scenarios** for every function.
Part B flattens all of those scenarios into a single, cross-functional catalogue for quick reference and gap-checking.
Where code or design artifacts hint at UI surface that is *not* exercised by any scenario, those elements are called out in **❗ Unused UI Elements** blocks.

---

## PART A Features → Functions → BDD Scenarios

> **Legend**
>
> * Feature = capability visible to users or operators
> * Function = cohesive unit of behaviour inside a feature
> * Actor abbreviations: **Admin**, **Researcher** (power user), **Analyst** (everyday user), **System** (automated agent or cron), **Model** (LLM or embedding service)

---

### 1 Source Registry & On-Ramp

| ID  | Function         | Expected Functionality                                                                                                                                      |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1 | Add Source       | Wizard to register a new static, semi-static, or dynamic source with metadata (type, URL/seed, crawl cadence, licensing, content class, credibility score). |
| 1.2 | Edit Source      | Inline or modal editor that allows changing cadence, parsing rules, or deprecating a source.                                                                |
| 1.3 | Source Audit Log | Time-stamped list of all create/update/delete events with diff + user attribution.                                                                          |
| 1.4 | Bulk Import      | CSV/JSON upload and mapping UI for onboarding >50 sources at once.                                                                                          |

#### BDD Scenarios

| #         | Scenario (Gherkin style)                                                                                                                                                                                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SR-01** | **Given** an Admin on the “Sources” page **When** they click “Add Source” and complete the wizard with a valid TikTok Guidelines URL **Then** the source appears in the registry with status = “Scheduled” and next-crawl timestamp set by default cadence. |
| **SR-02** | **Given** an Admin viewing a source **When** they change the cadence from weekly to daily **Then** the audit log records the change and the scheduling subsystem reschedules future ingestions.                                                             |
| **SR-03** | **Given** a bulk CSV containing 100 Reddit thread URLs **When** the Admin uploads and maps the columns **Then** 100 new sources are created and any duplicates are flagged in an import summary.                                                            |
| **SR-04** | **Given** a Researcher lacking Admin role **When** they attempt to delete a source **Then** they see a “Forbidden” message.                                                                                                                                 |

---

### 2 Ingestion Engine & Scheduler

| ID  | Function                | Expected Functionality                                                               |
| --- | ----------------------- | ------------------------------------------------------------------------------------ |
| 2.1 | Crawl Job Dispatch      | Celery / n8n workflow kicks off crawlers based on source cadence and queue capacity. |
| 2.2 | Content Fetcher         | Retrieves HTML, PDF, JSON, media; stores raw blob + canonical hash.                  |
| 2.3 | Pre-Parse Validation    | MIME/type sanity checks, robots.txt obedience, licensing flagging.                   |
| 2.4 | Change-Detection Filter | SHA-256 + semantic diff; skips unchanged documents, versions changed ones.           |

#### BDD Scenarios

| #         | Scenario                                                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IE-01** | **Given** a source scheduled for 03:00 **When** the scheduler reaches that time **Then** a “crawl” job is en-queued with priority derived from source criticality.                                        |
| **IE-02** | **Given** the fetcher retrieves a 10 MB PDF **When** the MIME type ≠ “application/pdf” **Then** the job fails with error code 415 and triggers an alert tag = “invalid\_mime”.                            |
| **IE-03** | **Given** a fetched HTML exactly identical to last version (byte + semantic) **When** the change detector compares hashes **Then** it sets outcome = “skipped\_no\_change” and no new version is created. |
| **IE-04** | **Given** the fetched page returns HTTP 429 **When** retries exceed allowed limit **Then** the source status flips to “Back-off” and Admins are notified by email + Slack.                                |

❗ **Unused UI Elements**
An “Ingestion Queue Depth” graph exists in the codebase’s React components but is **never surfaced** in current UI flows.

---

### 3 Normalization & Cleaning

| ID  | Function                         | Expected Functionality                                             |
| --- | -------------------------------- | ------------------------------------------------------------------ |
| 3.1 | Boilerplate Removal              | Strip nav/ads using Readability or trafilatura.                    |
| 3.2 | Language Detection & Translation | ISO-639-1 detection; auto-translate to English if not already.     |
| 3.3 | Tokenization & Chunking          | 4k-token safe chunks with document-level UUID references.          |
| 3.4 | Metadata Augmentation            | Adds crawl date, source credibility score, legal disclaimer flags. |

#### BDD Scenarios

| #         | Scenario                                                                                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **NC-01** | **Given** raw HTML with top nav and footer **When** boilerplate removal runs **Then** output text excludes any element tagged `<nav>` or `<footer>`.              |
| **NC-02** | **Given** content detected as “es” (Spanish) **When** auto-translate flag=true **Then** an English version is added with `lang_original="es"` metadata preserved. |
| **NC-03** | **Given** a 15k-token PDF **When** chunking executes **Then** it produces 4 chunks max 4k tokens each and records a parent\_document\_id.                         |

---

### 4 Semantic Enrichment

| ID  | Function                | Expected Functionality                                                       |
| --- | ----------------------- | ---------------------------------------------------------------------------- |
| 4.1 | Embedding Generator     | OpenAI text-embedding-3-small w/ fallback to local model.                    |
| 4.2 | Named-Entity Extraction | spaCy + rule-based extractions for platforms, policy sections.               |
| 4.3 | Classification          | Zero-shot labels: “Harassment”, “Minor Safety”, etc.                         |
| 4.4 | Knowledge-Graph Linker  | Maps entities to node IDs, creates edge list (policy → violation → penalty). |

#### BDD Scenarios

| #         | Scenario                                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SE-01** | **Given** a cleaned chunk **When** the embedder runs **Then** a 1536-float vector is saved in `vectors` table keyed by chunk\_id.                                                |
| **SE-02** | **Given** chunk text mentions “TikTok” and “Community Guidelines, Section 7” **When** NER executes **Then** two entities with types `Platform` and `PolicySection` are produced. |
| **SE-03** | **Given** classification returns confidence < 0.55 **When** threshold policy = 0.6 **Then** the label is discarded and the chunk is queued for human review.                     |

---

### 5 Storage Layer

\| ID | Function | Expected Functionality |
\|----|----------|
\| 5.1 | Relational Store | PostgreSQL running in Docker with schemas: `sources`, `documents`, `chunks`, `entities`, `jobs`, `users`. |
\| 5.2 | Vector DB | pgvector or Supabase Vector extension with HNSW indexing. |
\| 5.3 | Object Store | MinIO or S3 for raw blobs + thumbnails. |
\| 5.4 | Backup & Restore | Nightly `pg_dump`, daily object versioning, restore CLI. |

#### BDD Scenarios

| #         | Scenario                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **ST-01** | **Given** a new chunk vector **When** it’s inserted **Then** an HNSW index `idx_vectors_embedding` is auto-updated for ANN look-ups.      |
| **ST-02** | **Given** Admin runs `restore --point-in-time "2025-06-05T02:00"` **Then** database and object store roll back within ±1 minute accuracy. |

---

### 6 Query & Retrieval API

\| ID | Function | Expected Functionality |
\|----|----------|
\| 6.1 | Semantic Search Endpoint | `/v1/search` accepts JSON {query, top\_k, filters}. |
\| 6.2 | Citation Assembler | Returns text snippet + source URL + version date. |
\| 6.3 | Diff Endpoint | Compare two document versions; returns inline diff. |
\| 6.4 | Rate-Limiter | Token bucket keyed by API key + IP. |

#### BDD Scenarios

| #         | Scenario                                                                                                                                                              |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **QR-01** | **Given** POST `/v1/search` with `"Creator bullying guidelines TikTok"` **When** top\_k=3 **Then** response contains ≤3 citations, each with vector-similarity score. |
| **QR-02** | **Given** GET `/v1/diff?doc_id=123&v1=1&v2=3` **When** v2 > v1 **Then** response highlights additions in green and deletions in red HTML tags.                        |
| **QR-03** | **Given** 100 requests/min per key **When** limit=60 **Then** the API returns HTTP 429 for overflow calls and `Retry-After` header.                                   |

---

### 7 Alerts & Notifications

\| ID | Function | Expected Functionality |
\|----|----------|
\| 7.1 | Policy-Change Alert | Trigger on any diff with classification “policy”. |
\| 7.2 | Ingestion-Failure Alert | Slack + email with stacktrace & retry button. |
\| 7.3 | Threshold Watch | User-defined rules (e.g., “any change to ‘Harassment’ sections”). |
\| 7.4 | Digest Email | Daily summary of new entities & changes per platform. |

#### BDD Scenarios

| #         | Scenario                                                                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AL-01** | **Given** diff contains added sentence in TikTok Guidelines **When** rule “any policy change” is active **Then** alert fires with deep-link to diff UI. |
| **AL-02** | **Given** 5 ingestion jobs fail in a row **When** threshold=3 **Then** consolidated alert groups them into one Slack message.                           |

---

### 8 Dashboard UI

\| ID | Function | Expected Functionality |
\|----|----------|
\| 8.1 | Global Search Bar | Autocomplete on platform, policy topic, entity. |
\| 8.2 | Diff Viewer | Side-by-side or inline view; highlights and filters. |
\| 8.3 | Source Health Panel | Status badges, next crawl time, last success. |
\| 8.4 | Entity Explorer | Graph-like visualization of policy → consequence. |
\| 8.5 | Admin Settings | User management, API keys, cadence presets. |

#### BDD Scenarios

| #         | Scenario                                                                                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI-01** | **Given** Analyst types “minor safety” **When** autocomplete shows “TikTok • Minor Safety” **Then** selecting it brings up filtered policy sections chronologically. |
| **UI-02** | **Given** Analyst opens diff view **When** they toggle “inline” **Then** two-pane view collapses into one with colored markers.                                      |
| **UI-03** | **Given** Admin on Settings **When** they create API key label “R\&D” **Then** key string is shown once with copy-to-clipboard button.                               |

❗ **Unused UI Elements**
A “Dark/Light Theme Toggle” component exists but is **not linked** in any navbar or settings route.

---

### 9 Administration & Access Control

| ID  | Function          | Expected Functionality                                |
| --- | ----------------- | ----------------------------------------------------- |
| 9.1 | Role-Based ACL    | Roles: Admin, Researcher, Analyst, Read-Only.         |
| 9.2 | SSO Integration   | OIDC / Google Workspace.                              |
| 9.3 | Audit Trail       | Immutable log of privilege escalations & key actions. |
| 9.4 | API Key Lifecycle | Create, rotate, revoke keys, associate rate limits.   |

#### BDD Scenarios

| #         | Scenario                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **AD-01** | **Given** Analyst role **When** they request `/v1/search` **Then** allowed; **When** they POST new source **Then** HTTP 403. |
| **AD-02** | **Given** Admin rotates an API key **When** rotation succeeds **Then** old key is invalid after 60 sec grace.                |

---

### 10 Observability & Monitoring

\| ID | Function | Expected Functionality |
\|----|----------|
\| 10.1 | Metrics Collector | Prometheus gauges: job\_latency, queue\_depth, vector\_qps. |
\| 10.2 | Tracing | OpenTelemetry spans for ingest → search. |
\| 10.3 | Health Endpoints | `/healthz` for liveness, `/readyz` for readiness. |
\| 10.4 | Alertmanager Rules | CPU > 85% 5 min, failed\_jobs rate >2/min. |

#### BDD Scenarios

| #         | Scenario                                                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **OB-01** | **Given** queue\_depth rises above 1000 **When** Alertmanager rule triggers **Then** PagerDuty incident is created with runbook link. |
| **OB-02** | **Given** `/readyz` fails **When** Kubernetes probe fails three times **Then** pod restarts.                                          |

---

### 11 Agent Orchestration

\| ID | Function | Expected Functionality |
\|----|----------|
\| 11.1 | TaskMaster Plan Runner | Parses PRD tasks into n8n/AutoGen runs. |
\| 11.2 | Agent Memory | Redis stream keyed by conversation\_id. |
\| 11.3 | Retry & Escalation | If agent retries exceed N, escalate to human. |

#### BDD Scenarios

| #         | Scenario                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AG-01** | **Given** new “Add TikTok Policy” task in TaskMaster **When** Plan Runner executes **Then** agent chain queues ingestion → enrichment → alert tasks. |

---

### 12 Model Management

\| ID | Function | Expected Functionality |
\|----|----------|
\| 12.1 | Model Registry | Track embedding + LLM versions with provenance. |
\| 12.2 | A/B Routing | Percent-based traffic routing for model experiments. |
\| 12.3 | Batch Evaluation | BLEU / ROUGE / custom policy QA metrics each night. |

#### BDD Scenarios

| #         | Scenario                                                                                                                      |
| --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **MM-01** | **Given** new embedder v3 **When** Admin sets traffic=10% **Then** 10% of Vector inserts use v3; metrics isolate performance. |

---

### 13 Data Export & Integrations

\| ID | Function | Expected Functionality |
\|----|----------|
\| 13.1 | CSV/JSON Export | Search result set export with original citations. |
\| 13.2 | Webhook Push | Firehose of policy changes to external endpoint. |
\| 13.3 | BI Connector | Read-only Postgres replica for Metabase. |

#### BDD Scenarios

| #         | Scenario                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------- |
| **EX-01** | **Given** Analyst selects 50 rows **When** they click “Export CSV” **Then** a file downloads with UTF-8 encoding.       |
| **EX-02** | **Given** Admin configures webhook **When** new policy diff arrives **Then** POST JSON hits external URL within 60 sec. |

---

## PART B Unified Catalogue of BDD Scenarios

> (Ordered alphabetically by tag for easy lookup; duplicates merged.)

| Tag       | Scenario Summary                                          |
| --------- | --------------------------------------------------------- |
| **AD-01** | Role-based API enforcement blocks privilege elevation.    |
| **AD-02** | API-key rotation invalidates old key after grace period.  |
| **AG-01** | TaskMaster Plan Runner spawns agent chain for new task.   |
| **AL-01** | Automatic alert on any diff labelled “policy”.            |
| **AL-02** | Ingestion failure storm is grouped into single alert.     |
| **IE-01** | Scheduler enqueues crawl jobs based on cadence.           |
| **IE-02** | Invalid MIME triggers error and alert.                    |
| **IE-03** | Unchanged content skipped, conserving quota.              |
| **IE-04** | 429 back-off sets source status to “Back-off”.            |
| **MM-01** | Roll-out new embedding model to 10 % traffic slice.       |
| **NC-01** | Boilerplate removal strips `<nav>` and `<footer>`.        |
| **NC-02** | Auto-translation adds English layer & preserves metadata. |
| **NC-03** | Long docs chunked ⩽ 4 k tokens with parent linkage.       |
| **OB-01** | Queue depth alert pages on-call with runbook.             |
| **OB-02** | Kubernetes restarts unhealthy pod on `/readyz` failure.   |
| **QR-01** | Semantic search returns top-k citations & scores.         |
| **QR-02** | Diff endpoint highlights adds/dels between versions.      |
| **QR-03** | Token-bucket rate-limit emits HTTP 429 & retry header.    |
| **SE-01** | Embedding vector persisted per chunk.                     |
| **SE-02** | Custom NER extracts Platform + PolicySection entities.    |
| **SE-03** | Low-confidence classification routed to human review.     |
| **SR-01** | Admin registers new source via wizard.                    |
| **SR-02** | Changing cadence updates audit log & schedule.            |
| **SR-03** | Bulk import de-dupes and reports summary.                 |
| **SR-04** | Non-Admin cannot delete a source.                         |
| **ST-01** | Vector insert autoupdates ANN index.                      |
| **ST-02** | Point-in-time restore brings DB + objects back.           |
| **UI-01** | Global search autocomplete drives filtered results.       |
| **UI-02** | Diff viewer toggles side-by-side ↔ inline.                |
| **UI-03** | Admin creates API key and copies once.                    |
| **EX-01** | CSV export of selected rows.                              |
| **EX-02** | Webhook push on policy diff.                              |

Cross-feature patterns now stand out (e.g., alerting flows touch Ingestion, Diff, Observability; role enforcement appears in Registry, API, Admin). Use this catalogue to seed automated test-suites or acceptance criteria.

---

### Unused UI Elements (aggregate)

| Component/File                               | Observation                                  |
| -------------------------------------------- | -------------------------------------------- |
| Theme Toggle `ThemeSwitch.tsx`               | Rendered nowhere; dark/light not accessible. |
| Ingestion Queue Depth chart `QueueChart.vue` | Component imported by no route.              |
| “Invite User” modal stub                     | API endpoints exist but modal never linked.  |

Consider pruning or wiring these elements to avoid dead code and UX confusion.

---

### Next Steps

1. **Traceability matrix** – map every PRD requirement to the scenario tags above.
2. **Automate** – turn each scenario into Cypress/pytest-bdd cases.
3. **Design cleanup** – remove or integrate unused UI components.

This specification should now reflect **every meaningful interaction path** a user or automated actor can follow in the Intelligence Pipeline.
