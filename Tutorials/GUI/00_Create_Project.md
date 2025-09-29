### **Introduction**

The Heritage Data Processor application provides a streamlined and robust workflow for creating and managing digital heritage projects. This guide will walk you through the initial, crucial steps of this process: creating a new project using the New Project Wizard and subsequently loading an existing project. A thorough understanding of these preliminary procedures is essential for leveraging the full potential of the application's data processing and management capabilities.

### **Creating a New Project: The New Project Wizard**

The New Project Wizard is a step-by-step interface designed to ensure that your project is configured correctly from the outset. Each step gathers essential information about your project's structure, data, and processing requirements.

---

### **Step 1: Project Details**

This initial step captures the fundamental metadata for your project.

* **Project Name:** A descriptive, human-readable name for your project (e.g., "Roman Pottery Shards from the 2023 Excavation").
* **Project Short Code:** A concise, unique identifier used for file and folder naming. It should only contain letters, numbers, hyphens, and underscores (e.g., "RPS_2023").

> The **Project Short Code** is a critical component of the application's organizational structure. It helps to avoid file-naming conflicts and ensures a consistent and predictable directory layout for your project's data.

---

### **Step 2: Modality Templates**

Here, you will define the primary nature of your data. You are able to combine them, which will lead to presets for the user interface being merged, resulting in more precise suggestions during some workflows. The application currently supports this range of data modalities:

* Image / Photography
* 3D Model
* Audio
* Video
* Text / Document
* Software
* Structured Information
* Multimodal Dataset

> Selecting the correct modality is more than just a descriptive tag. The application uses this information to provide relevant file-scanning options and to suggest appropriate processing pipelines later in the workflow.

-----

### **Step 3: Data Paths Configuration**

This step establishes the locations for your project's input and output data.

  * **Input Data Directory:** The folder containing the raw, unprocessed source files for your project.
  * **Output Data Directory:** The folder where the application will save processed files and other generated outputs.
  * **File Processing Mode (Batch Entity):** This setting determines how the application groups files for processing and metadata assignment. This is a critical setting that dictates how your files are organized into distinct records for platforms like Zenodo.
      * **Root:** In this mode, each individual file within the **Input Data Directory** is treated as a separate and distinct record. This mode is ideal for datasets where each file is a standalone piece of information, such as a collection of photographs or individual documents.

        **Example Structure:**

        ```
        Input_Data_Directory/
        ├── image_01.jpg
        ├── image_02.jpg
        ├── document_A.pdf
        └── dataset.csv
        ```

        In this example, the application would create four separate records, one for each file.

      * **Subdirectory:** In this mode, each subfolder within the **Input Data Directory** is treated as a single record, and all the files within that subfolder are bundled together. This mode is particularly useful for complex datasets where multiple files contribute to a single conceptual entity, such as a 3D model with its associated textures or a research paper with its supplementary data.

        **Example Structure:**

        ```
        Input_Data_Directory/
        ├── 3D_Model_A/
        │   ├── model.obj
        │   ├── model.mtl
        │   └── texture.png
        └── Research_Paper_B/
            ├── paper.pdf
            └── data.xlsx
        ```

        In this example, the application would create two records: one for "3D\_Model\_A" (containing all three files within it) and one for "Research\_Paper\_B" (containing both the PDF and the spreadsheet).

      * **Hybrid:** This mode combines the logic of both **Root** and **Subdirectory** modes. The application will treat each individual file in the **Input Data Directory** as a separate record, and it will also treat each subfolder as a separate record, bundling the files within it. This provides the flexibility to manage both simple and complex data structures within the same project.

        **Example Structure:**

        ```
        Input_Data_Directory/
        ├── standalone_image.jpg
        └── 3D_Model_C/
            ├── model.obj
            ├── model.mtl
            └── texture.png
        ```

        In this example, the application would create two records: one for "standalone\_image.jpg" and another for "3D\_Model\_C" (containing all the files within that subfolder).

> The **File Processing Mode** is a powerful feature for managing complex datasets. A collection of individual photographs would be best handled with the **Root** mode. A series of related files (e.g., a 3D model and its associated texture files) could be grouped in a subfolder and processed using the **Subdirectory** mode. The **Hybrid** mode offers the most flexibility for projects with a mix of simple and complex data.

-----

### **Step 4: File Scan Options**

This step allows you to fine-tune how the application identifies and processes your files.

* **File Extensions to Scan:** You can specify the file types (e.g., `.jpg`, `.obj`, `.pdf`) that the application should look for in your input directory.
* **Bundling Options:**
    * **Bundle files with congruent filenames:** This option is useful when you have multiple files with the same base name but different extensions (e.g., `scan_01.jpg`, `scan_01.tif`, `scan_01.raw`). The application will group these files together.
    * **Primary Source File Extension:** When bundling is enabled, you must specify which file extension represents the primary source of metadata for the bundle.
* **3D Model (OBJ) Options:**
    * **Identify and add associated MTL file:** The application will automatically look for and link Material Template Library (`.mtl`) files to your `.obj` models.
    * **Identify and add associated Texture files:** The application will scan for and link texture image files (e.g., `.jpg`, `.png`) referenced in the `.mtl` file.
    * **Archive files in subdirectories:** For complex 3D models with many texture files, this option will create a `.zip` archive to keep the data organized.

> The **3D Model (OBJ) Options** are a powerful feature for managing complex 3D datasets. By automatically identifying and linking associated files, the application saves you the manual effort of organizing your model data and reduces the risk of errors.


---
#### **Additional Info: The Role of the Primary Source File**

The **Primary Source File** is a setting that designates one specific file within a "bundle" as the main entry point for metadata and hierarchical analysis. This option mostly becomes relevant when you enable the **"Bundle files with congruent filenames"** feature in the New Project Wizard.

**What is a File Bundle?**

A file bundle is a group of files that share the same base filename but have different extensions. This is common in many digital heritage contexts, especially with 3D models or complex datasets.

**Example Structure:**

```
Input_Data_Directory/
├── model_01.obj
├── model_01.mtl
├── model_01_diffuse.png
└── model_01_notes.txt
```

In this example, all four files constitute a single bundle because they share the "model\_01" base name.

**Why is a Primary Source File Necessary?**

Most importantly, it is necessary to be used for the Metadata Mapping as the reference file name. When the application encounters a bundle, it needs to know which file should be considered the "main" file. This is where the **Primary Source File** setting comes in. By selecting an extension (e.g., `.obj`), you are instructing the application to treat the file with that extension (`model_01.obj` in our example) as the primary entry point for this bundle.

**Functionality in the Workflow**

Once a file is designated as the primary source, the application uses it to initiate more detailed scanning operations. For instance, if an `.obj` file is the primary source, the application will then:

1.  Scan the contents of the `.obj` file to find references to its associated `.mtl` (material) file.
2.  Scan the `.mtl` file to find references to its associated texture files (e.g., `.png`, `.jpg`).
3.  Build a complete and accurate hierarchy of all the files in the bundle, with the primary source file at the top.

This ensures that complex, multi-file assets are correctly grouped and understood by the application, which is essential for accurate metadata assignment and streamlined processing in later stages of the workflow. Without the concept of a Primary Source File, the application would treat each file in the bundle as a separate, unrelated entity.

---

### **Step 5: Review Found Files**

After configuring your scan options, the application will perform a comprehensive analysis of your input directory and present you with a hierarchical list of all the files it has identified. This step is crucial for verifying that your data is correctly structured and free of issues before it is formally added to the project.

**File Validation and Statuses**

Each file in the list will be assigned a status that reflects the outcome of a validation process. This process checks for file integrity, readability, and, in the case of complex file types like 3D models, the presence of associated files. The possible statuses are:

* **Valid:** The file is readable and conforms to the basic structural requirements of its file type.
* **Invalid:** The file is corrupt, unreadable, or fails a critical validation check.
* **Problems:** The file has multiple issues, such as being invalid and also missing associated files.
* **MTL Missing:** For `.obj` files, this status indicates that a referenced Material Template Library (`.mtl`) file could not be found.
* **Textures Missing:** For `.mtl` files, this status indicates that one or more referenced texture files could not be found.
* **File Conflict:** This status arises when the application finds multiple, non-identical versions of a referenced file (e.g., two different `texture.png` files in different locations).

You can click on the status of any file to open a detailed report that provides specific information about any errors or warnings, as well as other relevant file details.

**Automatic Archiving for 3D Models**

For complex 3D models, particularly those with numerous texture files organized in subdirectories, the application provides an automatic archiving feature. If you enabled the **"Archive files in subdirectories"** option in the previous step, the application will:

1.  Identify all texture files and other secondary assets associated with your 3D model.
2.  Create a `.zip` archive containing these assets.
3.  Place the archive in your designated **Output Data Directory**.
4.  Link the archive to the primary model file in the project's file hierarchy.

This process simplifies the management of complex 3D data by bundling all associated files into a single, organized archive. This not only keeps your project directory tidy but also ensures that all necessary files are present when you later process or publish your data.

> The **Review Found Files** step is your opportunity to catch and address any issues with your data before they become problematic later in the workflow. Take the time to carefully review the file list and the validation reports to ensure that your project is built on a solid foundation of clean, well-structured data. If you identify any flaws, you can fix it and re-run the scan by clicking on **Back** and **Next** again.

---

### **Step 6: Project Creation Complete**

Once you have reviewed the file list and are satisfied with the configuration, the application will create the project's `.hdpc` file and you will be taken to the project dashboard.

### **Loading an Existing Project**

You can load an existing project at any time from the application's main welcome screen. Simply click the "Load Existing Project" button and select the appropriate `.hdpc` file. The application will then load the project's configuration and data, and you will be taken to the project dashboard, ready to continue your work.

> The `.hdpc` file is the central hub of your project. It is a database file that stores all of your project's configuration, file information, and processing history. It is therefore crucial that you keep this file in a safe and accessible location.