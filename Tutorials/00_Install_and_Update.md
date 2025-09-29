Note: This guide focuses on the recommended developer setup from the source code, as stable binary releases are not yet available.

-----

## **Installation and Update Guide: Heritage Data Processor (HDP)**

This document provides a detailed, step-by-step procedure for installing the **Heritage Data Processor (HDP)** from its source code. It also outlines the process for updating the application to the latest version. Given the software's **Alpha** status, this test- and development-focused installation is the currently recommended method.

⚠️ **Important Note:** HDP is in an early development phase. It is intended for testing and evaluation purposes only. Do not use it in a production environment or with sensitive data.

-----

### **Part 1: Prerequisites**

Before proceeding with the installation, your system must be equipped with several essential software development tools.

  * **Git:** For cloning the source code repository.
  * **Python:** The application specifically requires **Python version 3.11**.
  * **Node.js:** A recent Long-Term Support (LTS) version is required to build the user interface.
  * **uv:** A fast Python package installer and resolver used for managing the Python environment.
  * **System Build Tools:** Compilers and libraries necessary for building certain dependencies.
      * **macOS:** Xcode Command Line Tools.
      * **Linux:** `build-essential` package or equivalent.
      * **Windows:** Build Tools for Visual Studio.

-----

### **Part 2: Installation Process**

The installation is a multi-step process involving cloning the repository, setting up separate Python and Node.js environments, and installing system-level dependencies.

#### **Step 1: Obtain the Source Code**

First, clone the HDP repository to your local machine using **Git**. Open your terminal or command prompt and execute the following command:

```bash
git clone https://github.com/Digital-Humanities-Jena/heritage-data-processor.git
```

This will create a new directory named `heritage-data-processor` containing the application's source code. Navigate into this directory for all subsequent steps:

```bash
cd heritage-data-processor
```

-----

#### **Step 2: Configure the Python Environment**

This step uses `uv` to create an isolated Python environment, ensuring that HDP's dependencies do not conflict with other Python projects on your system.

1.  **Install uv**
    If you do not have `uv` installed, run the following command in your terminal:

    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

    After installation, verify it was successful by checking the version:

    ```bash
    uv --version
    ```

    💡 **Tip:** If the `curl` command fails, you may need to install it first (e.g., via `sudo apt install curl` on Debian/Ubuntu). On Windows, it is recommended to use PowerShell.

2.  **Create and Activate the Virtual Environment**
    Execute the following command to create a virtual environment within the project directory that uses Python 3.11:

    ```bash
    uv venv --python=3.11
    ```

    Next, activate the newly created environment. The command differs based on your operating system:

      * **macOS / Linux:**
        ```bash
        source .venv/bin/activate
        ```
      * **Windows (Command Prompt / PowerShell):**
        ```bash
        .venv\Scripts\activate
        ```

    💡 **Tip:** You will know the environment is active when its name, `(.venv)`, appears at the beginning of your terminal prompt. If the `uv venv` command fails because Python 3.11 is not found, you must install it first (e.g., via `brew install python@3.11` on macOS or from the official Python website).

3.  **Install Python Dependencies**
    With the virtual environment active, install all required Python packages from the `requirements.txt` file:

    ```bash
    uv pip install -r requirements.txt
    ```

    ⚠️ **Potential Error:** If you encounter compilation errors during this step, it often indicates missing system-level build tools. Ensure you have installed Xcode Command Line Tools (macOS), `build-essential` (Linux), or Build Tools for Visual Studio (Windows).

-----

#### **Step 3: Configure the Node.js Environment**

This step installs the dependencies required for the Electron-based user interface.

1.  **Install Node.js**
    If Node.js is not already installed, use the recommended method for your OS:

      * **macOS:**
        ```bash
        brew install node
        ```
      * **Linux (Debian/Ubuntu):**
        ```bash
        sudo apt update
        sudo apt install nodejs npm
        ```
      * **Windows:** Download the LTS installer from the [official Node.js website](https://nodejs.org/).

    Verify the installation by checking the versions:

    ```bash
    node -v
    npm -v
    ```

2.  **Install Node.js Dependencies**
    From the root of the project directory, run the following command to install all packages listed in `package.json`:

    ```bash
    npm install
    ```

    💡 **Tip:** If this command fails due to network issues or hangs, you can try cleaning the npm cache first with `$npm cache clean --force$` and then run `$npm install$` again.

-----

#### **Step 4: Install System Dependencies**

HDP relies on the `libmagic` library for file type identification.

  * **macOS:**
    ```bash
    brew install libmagic
    ```
  * **Linux (Debian/Ubuntu) & Windows (via WSL):**
    ```bash
    sudo apt-get update
    sudo apt-get install libmagic1-dev
    ```
    ⚠️ **Potential Error:** If you see a "command not found" error, ensure that Homebrew (`brew`) on macOS or APT (`apt-get`) on Linux is correctly installed and its path is configured in your shell.

-----

#### **Step 5: Launch the Application**

After completing all previous steps, you can start the application. Ensure your Python virtual environment is still active.

From the project's root directory, run:

```bash
npm start
```

This command will launch the HDP Electron application, which connects to the Python backend server. The initial launch may take a moment.

-----

### **Part 3: Updating the Software**

To benefit from new features and bug fixes, it is crucial to keep the software updated. The recommended method is to use Git to pull the latest changes.

1.  **Stash Local Changes (If Any)**
    If you have made local modifications (e.g., to the `config.yaml` file) that you wish to keep, it is best to stash them before updating:

    ```bash
    git stash
    ```

2.  **Pull Latest Changes**
    Fetch the latest version of the source code from the repository:

    ```bash
    git pull
    ```

3.  **Re-apply Stashed Changes**
    If you stashed changes in the first step, re-apply them:

    ```bash
    git stash pop
    ```

4.  **Update Dependencies**
    Project dependencies may have changed. It is essential to re-run the installation commands to ensure your environment is synchronized with the latest code:

      * Activate the Python virtual environment (`$source .venv/bin/activate$`).
      * Update Python packages:
        ```bash
        uv pip install -r requirements.txt
        ```
      * Update Node.js packages:
        ```bash
        npm install
        ```

After these steps, you can launch the updated application using `npm start`. Run this command in the repository directory `heritage-data-processor` using the Terminal, use `cd` followed by the path to this directory.