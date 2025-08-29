## **Heritage Data Processor (HDP): Enrich & Persistify your Cultural Heritage Data**

### **Introduction**
The **Heritage Data Processor (HDP)** is a sophisticated, GUI, API, and Command-Line-driven application designed for the comprehensive processing, enrichment, and management of digital assets, with a primary focus on multimodality. This toolbox provides a robust suite of functionalities for academics, researchers, and professionals in digital heritage and related fields. It leverages a powerful combination of machine learning models, large language models (LLMs), and external APIs to automate complex data-processing workflows.

The HDP is intended to be used for the construction of complex **Pipelines**, based on a modular system of **Pipeline Components**, with a persistent storage as its endpoint using **Zenodo**.

More information about this application will be provided soon.

#### **Pipeline Components**
The modular **Pipeline Components** that form the core of this application's processing capabilities will be added in an upcoming commit. A comprehensive **Developer's Guide** for creating and modifying these components will follow.

### **Planned Updates for Upcoming Version (0.1.0-alpha.3)**
* Modality Template for 3D Objects (automated or manual associated files determination + material path validation & bundling)
* Complex Pipeline Components (3D- and CUDA-related)


**Known Bugs** and some missing features are listed in the [Backlog](./BACKLOG.md) (incomplete).



## 🚧 (Early) Alpha Stage Software
This project is currently in its **Alpha phase**.
Several features and modules are **intentionally disabled** for safety and stability reasons.
As development progresses, these will be **gradually enabled** in future versions after further testing, validation, and security reviews.

At this point, the software is intended **only for testing, evaluation, and community feedback**.
Functionality, APIs, and data formats may change without notice until we reach a stable release.

**⚠ Important:** Do not use this software in production or for sensitive operations.

Bug reports, feedback, and contributions to help us reach a stable Beta and final release are highly welcomed. Please respect that, due to limited time resources, I can only work on this project for a few hours per week.

## Getting Started

### **Downloads & Releases**
You will be able to find the latest release binary for macOS, Windows and Linux in the Releases section of this repository after some testing is done around *v0.1.0-alpha.3*.

Please note that those binaries have undergone limited testing on one other machines.

#### **macOS Installation**
If you are using macOS, you will probably need to remove the quarantine attribute from the application after downloading it. To do so, open the Terminal and e.g. run the following command:

```bash
xattr -d com.apple.quarantine /path/to/Heritage\ Data\ Processor.app
```

### Developer Installation & Setup (recommended for now)
If you wish to run the application from the source code, you will need to set up both a Python and a Node.js environment.

#### Python Environment (uv)
1. **Install uv**:
   Follow the official installation instructions for uv on your operating system.
2. **Create and Activate Virtual Environment:**
   Navigate to the project's root directory and run the following commands:

    ```bash
    # --- Create a virtual environment named .venv using Python 3.11 ---
    uv venv python=3.11

    # --- Activate the environment ---
    # macOS/Linux:
    source .venv/bin/activate
    # Windows:
    .venv\Scripts\activate
    ```
3. **Install Python Dependencies:**
   ```python
   uv pip install -r requirements.txt
   ```

#### Node.js Environment & Running the App
The user interface is built using Electron and requires Node.js.

1. **Install Node.js:**
   Download and install a recent LTS version of Node.js from the official website.

2. **Install Node Dependencies:**
    In the project's root directory, run the following command to install the necessary packages listed in package.json:
    
    ```bash
    npm install
    ```

3. **Start the Application:**
    To launch the Heritage Data Processor, run:

    ```bash
    npm start
    ```

### **Enabling Alpha Features**

To enable experimental Alpha features, you will need to edit the main configuration file.

1. Navigate to the server\_app/data/ directory.  
2. Open the config.yaml file in a text editor.  
3. Locate the developer section and set the alpha\_features\_enabled flag to true:

```yaml
developer:  
  alpha_features_enabled: true
```

Please be aware that enabling these features may lead to unexpected behavior or instability.


# Disclaimer
**Status:** This software is in its initial **Alpha** stage of development.

This means:
- Core functionality may be incomplete.
- Essential features may be disabled, unstable, or subject to change.
- Bugs, security vulnerabilities, performance issues, and data loss scenarios are likely to occur.
- There is **no guarantee of reliability, correctness, or continuous availability**.

------------------------------------------------------------
### **Usage Restrictions**

It is **NOT RECOMMENDED** to use this software in:
- Production environments
- Safety-critical systems
- Systems handling sensitive, personal, financial, or confidential data
- Any context where failure or malfunction could cause harm, loss, or legal liability

This software is provided **for testing, experimentation, and feedback purposes only**.

------------------------------------------------------------
### **Stability & Compatibility**

- Backward compatibility between versions is **not guaranteed** during the Alpha phase.
- Saved data, configurations, and integrations may break without notice.
- The codebase, APIs, and user interface may change **significantly** from version to version.

------------------------------------------------------------
### **Legal Notice**

This software is provided **"AS IS"**, without warranty of any kind, express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, and non-infringement.

The authors or copyright holders are **not liable** for any claim, damages, or other liability—whether in an action of contract, tort, or otherwise—arising from, out of, or in connection with the software.

By downloading, installing, or using this software, you acknowledge and agree to this disclaimer.


## License
This project is licensed under the GNU General Public License v3.0. You are free to use, share, and modify this software under the terms of this license. For the full license text, please see the LICENSE.md file.