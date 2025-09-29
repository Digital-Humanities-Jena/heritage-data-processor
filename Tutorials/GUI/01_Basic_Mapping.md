### **Introduction: The Importance of Metadata Mapping**

The Heritage Data Processor application simplifies the complex task of preparing digital heritage data for preservation and publication. A cornerstone of this process is the **Metadata Mapping Wizard**. This guide explains the workflow for using this essential tool. Proper metadata mapping is the foundational step for all subsequent workflows, particularly the upload of records to repositories like Zenodo. It acts as a "translation key," enabling the application to understand how the data in your local files corresponds to the structured metadata fields required by the target repository.

### **The Metadata Mapping Workflow**

The Metadata Mapping Wizard provides a step-by-step interface to create a durable, reusable set of instructions that automates the process of metadata extraction and formatting, ensuring your data is ready for publication.

---

### **Step 1: Initiating the Mapping Process**

From the project dashboard, you can begin the mapping process in two ways, depending on your project's status:

* **Configure Mapping:** This is the starting point for a new project where no mapping has been defined. It launches the wizard from the beginning.
* **Reconfigure Mapping:** If a mapping already exists for your project, this option allows you to load the existing configuration into the wizard to make changes.

> In the current version, the application stores only one metadata mapping configuration per project. "Reconfigure Mapping" will overwrite the previous settings once you save your changes. This will be expanded in future. It is recommended to simply create another project for files that require different mappings.

---

### **Step 2: Selecting the Metadata Source File**

This step connects the wizard to your metadata. You will need to provide a spreadsheet that contains the descriptive information for your dataset.

* **Metadata File Format:** Choose the format of your metadata file. The application supports both CSV (Comma Separated Values) and Excel (`.xlsx`, `.xls`) formats.
* **Metadata File Path:** Click the "Browse" button to open a file dialog and select the metadata spreadsheet from your computer.
* **Select Column Containing Filenames:** This is the most critical part of this step. From the dropdown menu, you must select the column in your spreadsheet that contains the exact filenames of the source files in your project. This creates the essential link between a row of metadata in your file and the actual digital object it describes.

Once you select a file, the wizard will display a preview of its columns and the first five rows of data. This allows you to verify that you have selected the correct file and that the data is being read correctly before proceeding.

> The values in your selected "Filename Column" must be an exact match to the filenames in your project's input directory. For example, if your file is named `object_01.jpg`, the corresponding entry in the spreadsheet must also be `object_01.jpg`. Even a small typo will prevent the application from linking the metadata to the file.

---

### **Step 3: Configuring Field Mappings**

This is the core of the workflow, where you define the specific rules for how data from your spreadsheet columns is translated into Zenodo's metadata fields. For each Zenodo field, you can choose one of several mapping methods.

To illustrate, let's imagine we are working with a metadata spreadsheet that looks like this:

| object_filename    | title_main                         | title_subtitle         | creator_name     | creator_affiliation | creation_date |
| ------------------ | ---------------------------------- | ---------------------- | ---------------- | ------------------- | ------------- |
| `RPS_001.jpg`      | Amphora, Dressel 1 type            | Fragment from Rim      | Dr. John Doe | University of Hamburg | 2023-04-15    |
| `RPS_002.jpg`      | Terra Sigillata Bowl               | Base with Stamp        | Dr. John Doe | University of Hamburg | 2023-04-16    |

Here is how you would use the different mapping methods to populate the Zenodo record for `RPS_001.jpg`:

---

* **Map Column(s):** This allows you to directly link a Zenodo field to one or more columns in your spreadsheet. This is the most common mapping type.

    * **Example (Single Column):** To map the **Title**, you would select the "Map Column(s)" option and choose the `title_main` column from your spreadsheet. The application would then take the value "Amphora, Dressel 1 type" and use it as the title for the Zenodo record.
    * **Example (Multiple Columns):** Zenodo's **Title** field is a single field, but our spreadsheet has two title columns. We can combine them by selecting both `title_main` and `title_subtitle` and setting a delimiter, such as " - ". The application will automatically merge them into a single title: "Amphora, Dressel 1 type - Fragment from Rim".

---

* **From Filename:** This method uses the filename of the source file as the metadata value. This is useful for creating unique identifiers or when the filename itself contains important information.

    * **Example:** If you wanted to map the Zenodo **Version** field, you could select "From Filename" and choose the "stem" option. For the file `RPS_001.jpg`, this would automatically populate the Version field with the value "RPS_001".

---

* **Set Literal Value:** This allows you to provide a fixed, static value that will be applied to every record created using this mapping. This is ideal for metadata that is consistent across your entire dataset.

    * **Example:** For the Zenodo **Language** field, you could select "Set Literal Value" and enter "en" for English. Every record created with this mapping would then have its language set to English, saving you from having to create a separate column for it in your spreadsheet.

---

* **Select from List:** For Zenodo fields that have a controlled vocabulary (a predefined set of accepted values), this option will present you with a dropdown menu of the valid choices. This prevents errors and ensures your metadata conforms to Zenodo's standards.

    * **Example:** For the **Access Rights** field, you would select this option and choose "Open Access" from the list. This guarantees that your record will use a valid Zenodo term.

---

* **Construct Automatically:** This advanced option, available for the "Description" field, instructs the application to automatically generate a basic description based on the record's title.

    * **Example:** If you select this option, the application might generate a description such as: "Zenodo record for the data file: Amphora, Dressel 1 type - Fragment from Rim." This provides a useful default that you can always edit later if needed.

> Take your time during this step to ensure accuracy. For the **Creators** and **Contributors** fields, you can add multiple individuals or organizations. Each person or group is a separate "entry," and each entry has its own set of attributes (Name, Affiliation, ORCID, etc.) that you can map individually. For instance, to map the Creator for our example, you would create one entry and map its **Name** attribute to the `creator_name` column and its **Affiliation** attribute to the `creator_affiliation` column. This structured approach ensures your attribution metadata is rich and compliant with repository standards.

---

### **Step 4: Saving the Mapping Configuration**

After you have configured all the necessary fields, click the "Save Mapping" button. The application will save your configuration as part of your project's `.hdpc` file. This mapping is now "active" and will be used automatically by all subsequent processing and upload workflows.

### **Viewing and Managing Mappings**

Once a mapping is saved, the project dashboard will update to reflect its status. You can:

* **View Mapping:** Click this button to open a read-only view of your current mapping configuration. This is useful for quickly verifying your settings without the risk of accidentally making changes.
* **Reconfigure:** Click this button to launch the Metadata Mapping Wizard with your existing configuration pre-loaded, allowing you to make edits and save an updated version.

> Your metadata mapping configuration is a living part of your project. As your data or descriptive practices evolve, you can always return to the wizard to refine and update your mapping rules using updated spreadsheets, ensuring your project's metadata remains accurate and consistent over time.