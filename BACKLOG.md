# Roadmap: From Alpha to Beta — Known Bugs & Planned Feature Implementations

### Critical Bugs

- [ ] Fix Creators and Complex Field into Metadata Integration.
- [ ] Fix Creators and Complex Field Propagation to Record Creation.
    - Test Dates etc..
- [ ] Fix that Description is not being overwritten by Constructed Description (both GUI \& CLI).
- [ ] Fix that edited Metadata does not appear again after adding the Output Mapping Logic.
- [ ] Fix file type mismatches in file dialogs.
- [ ] Fix Keyword Handling (Merge, Separate correctly, Hierarchical Sorting).
- [ ] Fix Modality Template in Metadata Mapping Configuration Modal.
- [ ] Fix Output Directory ignorance.
- [ ] Fix that it always creates the directory "models".
- [ ] Fix that it should initially create the directories listed in "directories" in component.yaml.
- [ ] Reset Component Installation Modal State after uninstalling the same component (stale success message within session).
- [ ] Error when Components are being uninstalled and installed again within same session
- [ ] Tests within Component Execution Modal may fail if absolute paths are involved in the reference_data: modify those paths until a more intelligent solution is implemented.
- [ ] Fix Inconsistencies within Component Execution Templates.
- [ ] Fix that Output Directory in Component Execution Modal does not get set automatically in every case.
- [ ] "Clear" and "Download" (rename to "Export") button in Component Execution Modal not working.
- [ ] Partially false boolean parameters in component execution reports.


### UI/UX Features & Bugs

- [ ] Pipeline Constructor shows that the Zenodo Metadata was not set / mapped yet
- [ ] Menubar Items, including Components.
- [ ] "Dry" Component run: Show Result (JSON) directly in App.
- [ ] Add Refresh Button to Pipeline Components view.
- [ ] Extend Batch Operations (e.g., "Discard Drafts" in "Manage Drafts" tab) and make them work correctly.
- [ ] Upload Progress Bar.
- [ ] Upload Report Downloads.
- [ ] Fix Dark Mode.
- [ ] Rename "./pipeline_components" to "./hdp_components" for consistency


### Metadata \& mapping

- [ ] Create and Manage multiple Mappings per Project, apply in Pipeline, import/export as YAML.
- [ ] Complex / Nested Metadata does not get forwarded within Uploads view or during Pipeline Execution
- [ ] Description Constructor: Automatically convert linebreaks to HTML linebreaks etc..
- [ ] Detect if scanned file already associated to records in project
- [ ] Determine in Metadata Edit Modal that a specific field should not be overwritten by Pipeline (checkbox/switch).
- [ ] Fallback or Skip needed for missing Metadata / Mapping matches etc..
- [ ] Identify ways for a more generic mapping modal (e.g., reusable for EDM Mapping, METS/MODS Mapping etc.).
- [ ] Import YAML with Zenodo Metadata Mappings from Spreadsheet.
- [ ] Default Publication Date in English Format (YYYY-MM-DD) regardless of user location / configurations.
- [ ] Validate if Source File in Spreadsheet File.


### Uploads Section

- [ ] Bundle source files and associated files before draft creation - create file deposition preview per pre-draft
- [ ] Option to create local copies of records into defined directory


### Pipeline \& execution

- [ ] Add Retry Parameters → Define alternative Model.
- [ ] Evaluate functionalities for Subdirectory Scenario.
- [ ] Production / Non-Sandbox Logic with enhanced PII-related security mechanisms.
- [ ] Save Pipeline directly after creation with initial Source File (no component if not saved explicitly).
- [ ] Additionally use YAML as Pipeline instead of DB (= Overwrite?).
- [ ] Write JSON Results Item per Item instead of one File; consider Row IDX if already processed.


### Components \& converters

- [ ] Schema Update: multiple outputs with patterns --> align with main.py (currently: output-dir)
- [ ] Enable Root-Mode for OBJ+MTL with encoded Texture Files Collection.
- [ ] Implement extended version of EDM Generator Component (ready).
- [ ] Basic Converters.
- [ ] Evaluate reusable code snippets / templates for HDP Components.
- [ ] Evaluate LLM-conversion of existing code into HDP format.
- [ ] Write test-tools for component creators.


### Uploads \& API

- [ ] Add Upload Options (e.g., Abort Record Creation if File is not found).
- [ ] Before Upload: remove Absolute Paths in Test Data.
- [ ] Define file extensions to be considered in Project Creation, exclude others
- [ ] Upload new components and register them in API.


### HPC \& remote

- [ ] Setup "API Forwarder" connected to gpu_node on cluster via VPN and port tunneling; provide API without heavy local resource use (queue feedback needed).
- [ ] Create HPC Link Server that authenticates on HPC and streams files if requested (cybersecurity and legal checks required).
- [ ] Integrate HPC Interaction Hub (as already implemented in modavis).
- [ ] Send Job to Remote Instance (SSH → Zenodo CLI on HPC/Server).
- [ ] Try "Send Job to HPC".
    - Think about paths; provide settings; scp copy of env; create sbatch; etc..


### Infrastructure \& DevOps

- [ ] Build for Windows and Linux + Test.
- [ ] CUDA \& Co.: Ask in Installation Modal; also set via command.
- [ ] Integrate best practice logic for shared dependencies and storage optimization.
- [ ] Pipeline Components as Git Submodules


### Logging \& observability

- [ ] Enhance Logging / Feedback for Pipeline Execution.
- [ ] Pipeline Execution Log per Record into Output Directory (Paradata for each file).


### Code quality \& refactor

- [ ] Evaluate best practices of reusable functions for HDP Components.
- [ ] Refactor Legacy Code.
- [ ] Refactor styles.css.


### Security \& privacy

- [ ] Consider that PII Removal may lead to removal of CH addresses.


### Versioning \& release

- [ ] Check Versioning System using Hash again (logically).
    - Of course, new file does not have the same hash.
    - Maybe provide CSV with filename and target concept record id.
