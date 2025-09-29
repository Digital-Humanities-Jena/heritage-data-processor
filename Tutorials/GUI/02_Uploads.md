### **The Zenodo Upload Workflow**

### **Introduction: From Local File to Published Record**

The "Uploads" view is the central hub within the **Heritage Data Processor (HDP)** for managing the entire lifecycle of your data's publication to the Zenodo repository. After you have configured your project and defined your metadata mapping, this is where you will transform your local files into professionally structured, citable, and permanently archived digital records.

This workflow is designed as a clear, step-by-step progression, moving your data through distinct stages represented by tabs. This ensures that you have full control and visibility at every point, from initial metadata preparation to final publication and subsequent versioning.

### **The Uploads Interface: Key Components**

Before diving into the workflow, it's important to understand the main components of the Uploads interface.

* **Environment Selector (Sandbox vs. Production):** This is arguably the most critical setting in this view. It allows you to switch between two distinct Zenodo environments:
    * **Sandbox:** A testing environment provided by Zenodo. All records created here are for practice purposes only. They are not permanent, are not assigned real DOIs, and can be deleted. It is the perfect place to test your metadata mappings and familiarize yourself with the upload process without consequence.
    * **Production (Live):** This is the official, public Zenodo repository. **Any records published here are permanent, will be assigned a real DOI, and cannot be deleted.** The application will display a prominent warning when you are in this mode.

* **Workflow Tabs:** The interface is organized into a series of tabs that represent the sequential stages of the publication process. You will move your records from left to right through these tabs as you complete each step.


> Always begin your work in the **Sandbox** environment. Use it to perform a complete end-to-end test of your workflow for a few sample records. Only switch to the **Production** environment when you are confident that your metadata mapping is correct and you are ready to publish your data officially.
---

### **The Publication Lifecycle: Step-by-Step**

The journey of a file from a local asset to a published Zenodo record follows a logical progression through the workflow tabs.

### **Step 1: Prepare Metadata**

This is the initial stage for all new files that have been added to your project but have not yet been prepared for upload.

* **What you see:** A list of all source files (or file bundles) that are eligible for processing.
* **What you do here:** You apply your saved **Metadata Mapping** configuration to these files. This action reads the relevant information from your metadata spreadsheet (if you used one) and other sources, and structures it into a format that Zenodo will understand. This is a local operation; no information is sent to Zenodo at this stage.
* **Primary Actions:**
    * **Edit:** Allows you to preview the metadata that will be generated for a file based on the current mapping. You can also make one-off manual changes and overrides to the metadata for that specific file before preparing it.
    * **Prepare Metadata:** Executes the mapping process for the selected file(s). Upon successful preparation, the item will disappear from this tab and move to the "Create Draft" tab.

> If you configured your project to bundle files (e.g., a 3D model with its textures), you will see a single entry for the bundle here. Clicking the "View Bundle" button will open a detailed view of all the files included in that group and their validation statuses. This reflects the state of file bundling as in the last step of the New Project Wizard.

### **Step 2: Create Draft**

This tab lists all the records for which you have successfully prepared metadata. They are now ready for the first interaction with the Zenodo servers.

* **What you see:** A list of locally prepared records, showing their titles and the target environment (Sandbox or Production).
* **What you do here:** You instruct the application to communicate with Zenodo and create an actual draft record on their servers.
* **Primary Action:**
    * **Create Zenodo Draft:** This action sends the prepared metadata to the Zenodo API. Zenodo will create a new draft record in your account and return a unique Zenodo ID for it. The record will then move to the "Manage Drafts" tab.

### **Step 3: Manage Drafts**

This tab is your staging area for records that exist as drafts on Zenodo but are not yet published.

* **What you see:** A list of all your current draft records on Zenodo, showing their titles, Zenodo IDs, and the status of their associated file uploads.
* **What you do here:** You upload the actual data files to the draft records and, when ready, publish them.
* **Primary Actions:**
    * **View Files:** Opens a modal showing a list of all files associated with the draft and their individual upload statuses.
    * **Upload Files:** Initiates the upload of all pending files for that record from your local machine to the Zenodo draft.
    * **Publish:** This action becomes available only after all files for a record have been successfully uploaded. Clicking this will publish the record, making it publicly available on Zenodo and assigning it a permanent DOI. The record will then move to the "Published" tab.
    * **Discard:** Deletes the draft record from Zenodo's servers. This action is useful for cleaning up test records in the Sandbox or removing drafts you no longer intend to publish.

> You can click on the Zenodo ID of any draft to open it directly on the Zenodo website in a new browser tab. This is useful for verifying that the metadata and files look correct before you commit to publishing.

### **Step 4: Published Records**

This tab provides a view of all the records from your project that have been successfully published to Zenodo.

* **What you see:** A list of your published records, grouped by their "Concept ID." Each group shows all the available versions of that record.
* **What you do here:** The primary purpose of this view is to manage your published work and initiate the creation of new versions.
* **Primary Action:**
    * **Create New Version from Files...:** This initiates the versioning workflow, allowing you to create a new version of an existing published record, for example, to upload an updated dataset or a corrected file.

> Zenodo uses a **Concept ID** to group all versions of a single record together. While each version gets its own unique DOI (e.g., `10.5281/zenodo.1234568`), the Concept DOI (e.g., `10.5281/zenodo.1234567`) will always resolve to the most recent version.

### **Advanced Operations: Batch Actions**

For every stage before "Published," the application supports batch operations, allowing you to process many items at once.

1.  **Select Items:** Click the checkboxes next to the items you wish to process. You can use the "Select All" checkbox at the top to select all items currently visible in the list.
2.  **Choose Action:** From the "Select Batch Action" dropdown menu, choose the operation you want to perform (e.g., "Prepare Metadata," "Create Zenodo Drafts").
3.  **Execute:** Click the "Execute" button. A progress modal will appear, showing the status of the operation for each individual item.

> Batch actions are a powerful time-saving feature. You can, for instance, add a hundred new files to your project, prepare the metadata for all of them in a single batch operation, and then create the Zenodo drafts for all of them in a second batch operation.

## **Integrating Automated Processing: The Pipeline Workflow**

Beyond simple uploads, the Heritage Data Processor offers a powerful **pipeline functionality** directly within the Uploads view. Pipelines are custom-built, multi-step workflows (created in the **Pipeline Constructor**) that can perform a wide range of automated tasks on your data, such as image manipulation, 3D model optimization, or metadata extraction from text. Integrating these pipelines into your upload process allows for on-the-fly data processing and enrichment immediately before publication.

This functionality is primarily available in two key stages of the upload lifecycle: **creating new drafts** and **versioning published records**.

---

### **Executing Pipelines on New Records**

When you have records in the **"Create Draft"** tab, you have the option to run a pipeline on them *before* a draft is created on Zenodo. This is the ideal workflow for processing raw source files for their initial publication.

* **How it works:**
    1.  **Select a Pipeline:** A "Select Pipeline for Execution" section will appear above the list of records. From this dropdown menu, you can choose any of the pipelines you have previously created.
    2.  **Filter Records (Optional):** You can choose to run the pipeline on all records in the list, or you can use the filtering options to select a specific subset based on their title, creation date, or a search term.
    3.  **Initiate Execution:** Click the "Initiate Pipeline Execution" button.

* **What Happens Next:** The application will execute the selected pipeline for each of the targeted records. This process typically involves:
    * Running the defined processing steps (e.g., resizing an image, converting a file format).
    * Generating new, "derived" files based on the pipeline's output.
    * **Automatically creating a new draft on Zenodo** that may include both the original source file and any new files generated by the pipeline.
    * **Overwriting metadata:** If the pipeline is configured to extract metadata (e.g., technical specifications from an image), this new information can automatically overwrite the data you provided in your initial metadata mapping. This is a pretty powerful feature, especially if combined with LLM-/AI-based HDP components.

Once the process is complete, the original record will be removed from the "Create Draft" tab, and a new, enriched draft record will appear in the "Manage Drafts" tab, ready for file upload and publication.

> The pipeline execution is a non-destructive process for your original source files. All generated files are saved to your project's designated **Output Data Directory**, leaving your original data untouched. The application intelligently links these new, derived files to the Zenodo record.

---

### **Using Pipelines for Versioning Published Records**

The pipeline functionality is also seamlessly integrated into the versioning workflow, allowing you to process new data and create an updated version of an already published record.

* **How it works:**
    1.  **Initiate Versioning:** From the **"Published"** tab, click the "Create New Version from Files..." button. This will open a modal where you select the new source files for the updated version.
    2.  **Select a Pipeline:** After matching the new files to existing records, you will be prompted to select a pipeline to run. This is a mandatory step in the versioning-from-files workflow.
    3.  **Confirm and Execute:** Once you confirm your selection, the application will initiate the versioning process.

* **What Happens Next:** The application performs a series of automated steps:
    1.  It communicates with the Zenodo API to create a new draft version of your published record.
    2.  It runs the selected pipeline on the new source file(s) you provided.
    3.  It uploads the outputs of the pipeline to the new Zenodo draft.
    4.  It intelligently manages the file manifest, allowing you to either carry over all files from the previous version or replace them with the new files.
    5.  The newly created draft, containing the processed files, will appear in the "Manage Drafts" tab, ready for you to review and publish.

> This workflow is exceptionally powerful for projects with evolving datasets. For example, if you have a new, higher-resolution 3D scan of an artifact, you can use this process to run an optimization pipeline on the new scan and publish it as a new version of the existing record, all in a single, streamlined operation. The application handles the complexities of API communication and file management behind the scenes.