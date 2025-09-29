## **Guide to Zenodo API Key Configuration for HDP**

To enable the **Heritage Data Processor (HDP)** to upload and manage data on **Zenodo**, you must first configure it with the appropriate API credentials. This guide details the process of creating accounts, generating API keys (Personal Access Tokens) for both the Zenodo Sandbox and the production Zenodo environments, and correctly configuring them in the application.

**Zenodo** is an open-access repository for storing datasets, software, and other research artifacts. It provides two distinct platforms:

  * **Zenodo Sandbox:** A testing environment (`https://sandbox.zenodo.org/`) for experimenting with uploads without creating permanent, citable records.
  * **Zenodo Production:** The official, live repository (`https://zenodo.org/`) for publishing permanent digital objects.

These are separate services and require separate accounts and API keys.

-----

### **Part 1: Zenodo Sandbox API Key (Testing Environment)**

It's highly recommended to begin with the Sandbox to familiarize yourself with the process.

#### **Step 1: Register a Sandbox Account**

1.  Navigate to the Zenodo Sandbox website: `$https://sandbox.zenodo.org/`.
2.  Click the **"Sign up"** button. You can register using your email address or by linking an existing GitHub or ORCID account. It is recommended to use your email instead of relying on institutional accounts.
3.  Complete the registration process. Remember, this account is entirely separate from any account you might have on the main Zenodo site. You can even use the same credentials.

#### **Step 2: Generate a Personal Access Token**

1.  Once logged in, click your account name in the top-right corner and select **"Applications"** from the dropdown menu.
2.  On the left-hand menu, click on **"Personal access tokens"**.
3.  Click the **"New token"** button.
4.  Fill out the token creation form:
      * **Name:** Provide a descriptive name for your key, for example, `HDP_Sandbox_Key`.
      * **Scopes:** Scopes define the permissions your key will have. For HDP to manage uploads, you must select the `deposit:write` scope. This allows the application to create and edit records on your behalf. You can simply enable all of those checkboxes.
5.  Click the **"Create"** button.

⚠️ **Important:** Your new API key will be displayed on the next screen. This is the **only time** it will be shown. Copy it immediately and store it in a secure location, as you will need it for the final configuration step.

-----

### **Part 2: Zenodo Production API Key (Live Environment)**

After successfully configuring the Sandbox, you can repeat the process for the live Zenodo environment. This key will allow HDP to publish permanent, citable data.

The procedure is identical to the Sandbox setup:

1.  Navigate to the official Zenodo website: `$https://zenodo.org/`.
2.  **Sign up** for a new account or log in if you already have one.
3.  Go to **"Applications"** \> **"Personal access tokens"** and click **"New token"**.
4.  Provide a distinct name, such as `HDP_Production_Key`, and select at least the `deposit:write` scope.
5.  Click **"Create"** and securely copy the generated API key. 🔑

-----

### **Part 3: Configure the HDP Environment File**

The final step is to place your newly generated keys into the application's configuration file.

1.  **Locate and Open the File:** In the root directory of your HDP project, find the file named `example.env`. Open it with any plain text editor.

2.  **Insert Your Keys:** The file will contain the following template:

    ```
    ZENODO_API_KEY=insert_your_zenodo_api_key_here_and_rename_file_to_zenodo.env
    ZENODO_SANDBOX_API_KEY=insert_your_zenodo_sandbox_api_key_here_and_rename_file_to_zenodo.env
    ```

      * Replace the placeholder text after `ZENODO_API_KEY=` with the key you generated from the main **Zenodo** site (`https://zenodo.org/`). Keep an eye on trailing whitespaces after pasting it.
      * Replace the placeholder text after `ZENODO_SANDBOX_API_KEY=` with the key you generated from the **Zenodo Sandbox** (`https://sandbox.zenodo.org/`).

    Your file should now look similar to this (with your actual keys):

    ```
    ZENODO_API_KEY=AbCDeFGHijKLMnOPqRsTUVwXyZ123456AbcDEfGHiJKLMnoPQ
    ZENODO_SANDBOX_API_KEY=sAndBoXkEyAbcDEfGHIjKlmNOPqRStuvWXyZ123456aBcDeFg
    ```

3.  **Rename the File:** After saving your changes, rename the file from `example.env` to `zenodo.env`.

This renaming step is crucial. The application is designed to load credentials specifically from a file named `zenodo.env`. This convention also helps prevent you from accidentally committing your secret keys to a version control system like Git.

Your HDP application is now fully configured to interact with both the Zenodo Sandbox and production services.