# HDP Pipeline Component Developer's Guide and References

**Note**: This version of the Developer's Guide is linked to the **HDP Component Schema Version 0.1.0-alpha.2** and is still under development, both regarding its structure and integration within the HDP. The mentioned **Component Uploader** is still under development, and fields regarding the `requirements` are currently placeholders for upcoming features regarding the installation of HDP Components (use `requirements.txt` for this, which is intended to continue to be used).

***

## Introduction

The Heritage Data Processor (HDP) utilizes a modular architecture built around standardized Pipeline Components that enable flexible, reusable data processing workflows. At the heart of each Pipeline Component lies the **`component.yaml`** file, which serves as the definitive specification document that describes the component's metadata, structure, inputs, outputs, parameters, requirements, and execution characteristics.

### Component Architecture Overview

Each HDP Pipeline Component follows a three-tier architectural pattern that ensures consistency, maintainability, and interoperability:

1. **`component.yaml`** - The specification layer that defines all component characteristics, parameters, and requirements
2. **`main.py`** - The interface layer that provides CLI functionality and parameter handling
3. **`processor.py`** - The core logic layer containing the actual processing implementation (preferably class-based/OOP)

The relationship between these files is hierarchical and must maintain strict consistency: all parameters, inputs, and outputs defined in `component.yaml` must be properly handled in `main.py`, which in turn must correctly interface with the processing logic implemented in `processor.py`.

### Component Distribution and Discovery

All validated HDP Pipeline Components are published and distributed through the dedicated Zenodo Community: **[Heritage Data Processor Components](https://zenodo.org/communities/hdp-components)**. This community serves as the central repository where components are stored with proper versioning, DOI assignment, and metadata preservation. Each component undergoes validation through the **Component Uploader** before being made available to the broader HDP ecosystem.

Users can discover, download, and integrate these components into their processing pipelines, ensuring reproducible and standardized data processing workflows across different heritage data projects and institutions.

### Standardized File Structure and Responsibilities

#### The CLI Interface Layer (`main.py`)

The `main.py` file serves as the primary entry point for command-line execution and acts as a crucial bridge between the HDP execution environment and the component's core processing logic. This file has several key responsibilities:

- **Argument Parsing**: Utilizes `argparse` to define and parse all command-line arguments that correspond directly to the inputs and parameters specified in `component.yaml`
- **Input Validation**: Performs preliminary validation of provided arguments, including mutual exclusivity checks and required parameter verification
- **Parameter Mapping**: Transforms CLI arguments into the appropriate data types and structures expected by the processor class
- **Execution Orchestration**: Instantiates the processor class with parsed parameters and calls the appropriate processing methods
- **Output Management**: Handles the creation of output directories and files, ensuring results are written to the specified locations
- **Status Reporting**: Provides feedback on execution success or failure, including appropriate exit codes for pipeline integration

The CLI interface must maintain strict alignment with the `component.yaml` specification - every input, output, and parameter defined in the YAML must have corresponding handling in `main.py`.

#### The Core Processing Layer (`processor.py`)

The `processor.py` file contains the actual implementation logic and represents the computational heart of the component. Following object-oriented programming principles, this file typically implements:

- **Processor Class**: A main class that encapsulates all processing functionality and maintains state throughout execution
- **Method-based Processing**: Separate methods for different processing modes (e.g., single file vs. batch processing, different input types)
- **Error Handling**: Comprehensive exception handling with meaningful error messages and graceful degradation
- **Logging and Monitoring**: Detailed execution tracking, progress reporting, and performance metrics
- **Extensibility**: Modular design that allows for easy extension and customization of processing logic
- **Library Interface**: The processor class can be imported and used programmatically, independent of the CLI interface

The processor implementation should be technology-agnostic where possible, focusing on the core algorithmic logic while delegating platform-specific operations to helper modules or external dependencies.

#### Integration and Consistency Requirements

The three-layer architecture ensures that components are both user-friendly and technically robust. The `component.yaml` serves as the single source of truth, with `main.py` providing accessible CLI interaction and `processor.py` delivering reliable, reusable processing capabilities. This separation of concerns enables components to be:

- **CLI-driven** for direct command-line usage and pipeline integration
- **Library-compatible** for programmatic integration into larger applications
- **Specification-compliant** with guaranteed consistency between declared capabilities and actual implementation
- **Maintainable** through clear separation of interface logic and processing algorithms


## Three-Layer Architecture Example

This section demonstrates how `processor.py`, `main.py`, and `component.yaml` work together in strict alignment. The example shows a simple **Text Converter** component.

### Layer 1: Core Logic (`processor.py`)

```python
[...]
class TextConverter:
    def __init__(self, output_format: str = "uppercase", preserve_spaces: bool = True):
        self.output_format = output_format      # matches component.yaml parameter
        self.preserve_spaces = preserve_spaces  # matches component.yaml parameter
    
    def process_file(self, input_path: str) -> dict:
        with open(input_path, 'r') as f:
            text = f.read()
        
        if self.output_format == "uppercase":
            result = text.upper()
        elif self.output_format == "lowercase": 
            result = text.lower()
        
        if not self.preserve_spaces:
            result = result.replace(' ', '')
            
        return {"original_length": len(text), "converted_text": result}
[...]
```


### Layer 2: CLI Interface (`main.py`)

```python
[...]
def parse_args():
    parser = argparse.ArgumentParser()
    
    # INPUT (matches component.yaml inputs)
    parser.add_argument("--input-file", required=True)  # name: input_file
    parser.add_argument("--output", required=True)
    
    # PARAMETERS (matches component.yaml parameters exactly)
    parser.add_argument("--output-format",              # name: output_format 
                       default="uppercase",             # default: "uppercase"
                       choices=["uppercase", "lowercase"])  # options: [...]
    parser.add_argument("--preserve-spaces",            # name: preserve_spaces
                       action="store_true",             # type: boolean
                       default=True)                    # default: "true"
    return parser.parse_args()

def main():
    args = parse_args()
    
    # Pass ALL parameters to processor (strict alignment)
    converter = TextConverter(
        output_format=args.output_format,    # component.yaml → CLI → processor
        preserve_spaces=args.preserve_spaces # component.yaml → CLI → processor  
    )
    
    result = converter.process_file(args.input_file)
    # Write output...
[...]
```


### Layer 3: Component Specification (`component.yaml`)

```yaml
[...]
inputs:
  - name: input_file          # → main.py: --input-file
    label: Input Text File
    type: file_path
    required: true

parameter_groups:
  - title: Conversion Settings
    parameters:
      - name: output_format     # → main.py: --output-format → processor.py: output_format
        label: Output Format
        type: string_dropdown   # → main.py: choices=[]
        default: "uppercase"    # → main.py: default="uppercase"
        options: ["uppercase", "lowercase"]  # → main.py: choices=[...]
      
      - name: preserve_spaces   # → main.py: --preserve-spaces → processor.py: preserve_spaces  
        label: Preserve Spaces
        type: boolean           # → main.py: action="store_true"
        default: "true"         # → main.py: default=True
[...]
```


## Direct Alignment Flow

```
component.yaml          →    main.py                →    processor.py
──────────────               ────────                     ─────────────
name: input_file        →    --input-file            →    process_file(input_path)
name: output_format     →    --output-format         →    output_format parameter
type: string_dropdown   →    choices=["up", "low"]   →    str type
default: "uppercase"    →    default="uppercase"     →    "uppercase" 
type: boolean           →    action="store_true"     →    bool type
default: "true"         →    default=True            →    True
```

**Congruency and Dependency**: The three layers have a **hierarchical dependency** where `component.yaml` ↔ `main.py` must be perfectly congruent (every parameter, input, and output must match exactly), and `main.py` ↔ `processor.py` must be functionally aligned (all declared parameters must be passed to the processor). However, `component.yaml` does not need to be directly congruent with `processor.py` - the processor can have additional capabilities or internal methods not exposed through the component specification, but it must support all functionality declared in the YAML through the parameters passed via `main.py`.

Note: Of course, you are free to reduce the redundancy, e.g. in _choices_. Here, it was used to exemplify the alignment flow.


## Component Structure Example (`component.yaml`)
```yaml
metadata:
  name: audio_converter
  label: Audio Format Converter
  description: >
    Converts audio files between different formats (MP3, WAV, FLAC, OGG, M4A) with 
    configurable quality settings. Supports both single file and batch processing 
    with advanced codec options and metadata preservation.
  tags:
    - audio
    - conversion
    - format
    - codec
    - multimedia
  keywords:
    - audio converter
    - ffmpeg
    - mp3
    - wav
    - flac
    - batch processing
  category: Media Processing
  version: "1.2.0"
  status: stable
  created: "2024-01-15"
  updated: "2025-08-21"
  authors:
    - name: "Smith, John"
      affiliation: "Digital Media Research Institute"
      orcid: "0000-0002-1234-5678"
    - name: "Johnson, Sarah"
      affiliation: "Audio Technology Lab"
      orcid: "0000-0003-9876-5432"
  contact:
    email: "audio-converter-support@example.org"
  license:
    type: "MIT"
    url: "https://opensource.org/licenses/MIT"
  component_schema: "0.1.0-alpha.2"

sources:
  record: ""
  doi: ""
  concept_doi: ""
  changelog: ""
  git: "https://github.com/hdp-components/audio-converter"

structure:
  required_files:
    - "src/audio_converter.py"
    - "src/utils.py"
    - "requirements.txt"
    - "README.md"
    - "tests/sample_audio.wav"
    - "tests/sample_audio.mp3"
  additional_files:
    - "tests/batch_samples/*"
    - "docs/usage_guide.md"
    - "configs/quality_presets.yaml"
  directories:
    - "output"
    - "temp"
    - "logs"

inputs:
  - name: input-file
    label: Input Audio File
    description: >
      Single audio file to be converted. Supports common audio formats 
      including MP3, WAV, FLAC, OGG, M4A, and AAC.
    type: file_path
    default: "./tests/sample_audio.wav"
    required: false
    validation_rules:
      file_extensions: [".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac", ".wma"]
      min_size_bytes: "1024"
    mutex_with: ["input-dir"]
  
  - name: input-dir
    label: Input Directory
    description: >
      Directory containing multiple audio files for batch conversion. 
      All supported audio files in the directory will be processed.
    type: dir_path
    default: ""
    required: false
    mutex_with: ["input-file"]

outputs:
  - name: output-file
    label: Converted Audio File
    pattern: "{original_stem}_converted"
    description: >
      Single converted audio file with the specified format and quality settings.
    category: metadata
    type: "audio/*"
  
  - name: output-dir
    label: Output Directory
    description: >
      Directory containing all converted audio files when processing in batch mode.
    category: metadata
    type: "application/octet-stream"

parameter_groups:
  - title: Output Format Settings
    description: Configure the output audio format and codec options
    parameters:
      - name: output-format
        label: Output Format
        type: string_dropdown
        default: "mp3"
        options: ["mp3", "wav", "flac", "ogg", "m4a", "aac"]
        description: Target audio format for conversion
      
      - name: codec
        label: Audio Codec
        type: string_dropdown
        default: "auto"
        options: ["auto", "libmp3lame", "pcm_s16le", "flac", "libvorbis", "aac"]
        description: Specific codec to use for encoding (auto selects best for format)
  
  - title: Quality Settings
    description: Configure audio quality and compression parameters
    parameters:
      - name: bitrate
        label: Bitrate (kbps)
        type: integer
        default: "192"
        description: Audio bitrate in kilobits per second (higher = better quality)
      
      - name: sample-rate
        label: Sample Rate (Hz)
        type: integer
        default: "44100"
        description: Audio sample rate in Hz (44100 is CD quality)
      
      - name: quality-preset
        label: Quality Preset
        type: string_dropdown
        default: "standard"
        options: ["low", "standard", "high", "lossless"]
        description: Predefined quality settings that override individual parameters
      
      - name: preserve-metadata
        label: Preserve Metadata
        type: boolean
        default: "true"
        description: Keep original metadata tags (title, artist, album, etc.)
  
  - title: Processing Options
    description: Advanced processing and output options
    parameters:
      - name: overwriteexisting
        label: Overwrite Existing Files
        type: boolean
        default: "false"
        description: Overwrite output files if they already exist
      
      - name: normalize-audio
        label: Normalize Audio Levels
        type: boolean
        default: "false"
        description: Apply audio level normalization to prevent clipping
      
      - name: output-directory
        label: Custom Output Directory
        type: dir_path
        default: "./output"
        description: Specify custom directory for converted files
        validation_rules:
          file_extensions: []

requirements:
  python_environment:
    python_version: ">=3.8"
    packages:
      - name: "pydub"
        version: ">=0.25.0"
      - name: "mutagen"
        version: ">=1.45.0"
      - name: "pyyaml"
        version: ">=6.0"
      - name: "pathlib"
        version: ""
      - name: "logging"
        version: ""
  
  system_dependencies:
    - name: "ffmpeg"
      version: ">=4.0"
      required: true
      description: "FFmpeg multimedia framework for audio/video processing"
      type: "package"
      install:
        methods:
          - type: "apt"
            command: "sudo apt-get update && sudo apt-get install -y ffmpeg"
            platforms: ["ubuntu", "debian"]
          - type: "yum"
            command: "sudo yum install -y ffmpeg"
            platforms: ["centos", "rhel", "fedora"]
          - type: "brew"
            command: "brew install ffmpeg"
            platforms: ["macos"]
          - type: "choco"
            command: "choco install ffmpeg"
            platforms: ["windows"]
        post_install:
          environment:
            FFMPEG_PATH: "/usr/bin/ffmpeg"
      verify:
        command: "ffmpeg -version"
        expected_pattern: "ffmpeg version [4-9]"
  
  system_requirements:
    min_memory_mb: 512
    recommended_memory_mb: 2048
    min_disk_space_mb: 1024

execution:
  idempotent: true
  timeout: 3600
```

### Sections in Component YAML


#### Section: `metadata`\* (`object`)
* `name`\* (`string`): Unique Identifier of the Pipeline Component. The _Component Uploader_ checks if it is already taken or not. Must follow naming conventions (lowercase, underscores allowed, no spaces, no special characters). **Important**: This identifier and the directory name must be congruent.
* `label`\* (`string`): Human-readable title of the Pipeline Component displayed in user interfaces.
* `description`\* (`string`): Short description of the Pipeline Component's functionality, purpose, and use cases. Use `>` instead of `|` for longer descriptions (recommended).
* `tags` (`array of strings`): Component tags describing the function as precise as possible.
* `keywords` (`array of strings`): Keywords that describe the pipeline component more freely.
* `category`\* (`string`): Category of the Pipeline Component (Controlled Vocabulary). This category can be manually set within the _Component Uploader_ and/or aligned to what is encoded in the YAML using a fuzzy logic (which must be approved by the uploader afterwards).
* `version`\* (`string`): Semantic version number of the component following SemVer format (e.g., "1.0.0", "0.1.0-alpha.1"). Supports pre-release identifiers like _alpha_, _beta_, etc.
* `status` (`string`): Development status of the component. Valid values:
  * `alpha`: Early development, may have significant changes.
  * `beta`: Feature-complete but may contain bugs.
  * `stable`: Production-ready and thoroughly tested.
  * `deprecated`: No longer maintained, use discouraged.
* `created`\* (`string`): ISO 8601 date when the component was first created ("YYYY-MM-DD").
* `updated`\* (`string`): ISO 8601 date of the current updated version ("YYYY-MM-DD"). Same as `created` if initial. If left empty, the _Component Uploader_ will set this date to the current one.
* `authors`\* (`array of objects`): List of component authors with more or less detailed information:
  * `name`\* (`string`): Full name of the author (format: "Lastname, Firstname").
  * `affiliation` (`string`): Institutional affiliation.
  * `orcid` (`string`): ORCID identifier for academic attribution.
* `contact` (`string`): Contact information for component support:
  * `email`\* (`string`): Primary contact email address. Of course, this can be masked against crawlers.
* `license`\* (`object`): Licensing information:
  * `type`\* (`string`): License type (e.g., "MIT", "GPLv3", "Apache-2.0").
  * `url` (`string`): URL to the full license text.
* `component_schema`\* (`string`): Version of the used Component Schema. Initiated with `0.1.0-alpha.2`.


#### Section: `sources`\* (`object`)
* `record` (`string`): Unique Zenodo Record Identifier of the component version. It will be registered automatically by the _Component Uploader_ after a successful validation and draft creation.
* `doi` (`string`): Digital Object Identifier (DOI) of the Zenodo Record for the specific version of the component. The format will be "10.5281/zenodo.1234567". It will be registered automatically by the _Component Uploader_ after a successful validation and draft creation.
* `concept_doi`(`string`): Concept DOI that represents all versions of the component, providing a persistent identifier that always resolves to the latest version. Used for general citations regardless of specific version. It will be registered automatically by the _Component Uploader_ after a successful validation and draft creation.
* `changelog` (`string`): URL to the component's changelog documentation, detailing version history, bug fixes, and feature additions. By default, it will be linked to the `CHANGELOG.md` that is stored within the Zenodo Record of the associated version, so this will be encoded automatically as well by the _Component Uploader_.
* `git` (`string`): URL to the Git repository containing the component's source code. Should be a complete, public or private repository URL (e.g., "https://github.com/username/repository").


#### Section: `structure`\* (`object`)
* `required_files`\* (`array of strings`): Files that are required for the component to run successfully in its basic mode. This should include at least the minimum set of test files. The files listed here will be added to `component_basic.zip` and `component_complete.zip` by the _Component Uploader_.
* `additional_files`\* (`array of strings`): Additional files that are enhancing the functionalities of the component or enlarge the quantity of test files. The files listed here will be added to `component_complete.zip` by the _Component Uploader_.
* `directories`\* (`array of strings`): The listed `directories` will be created by the installation script as empty directories and those that are intended to be populated. This allows running components in minimal setups using the data provided in the Zenodo Record only, without requiring the potentially large archive files.
* **Important Note**: If there are <u>too many files</u> to be referenced individually, use "/\*" instead, e.g.: `src/assets/images/*` or `src/assets/images/classes/**/*`, where **\*** acts as a wildcard for files, and **\*\*** for directories.


#### Section: `inputs`\* (`array of objects`)
* `name`\* (`string`): Unique input identifier for the input parameter within the component. Must follow naming conventions (lowercase, underscores allowed, no spaces, no special characters). Most commonly, these are named `input_file` (Single Mode) and `input_dir` (Batch Mode).
* `label`\* (`string`): Human-readable name for the input parameter displayed in user interfaces.
* `description` (`string`): Short description of the input parameter's purpose and expected content. Use > instead of | for longer descriptions (recommended).
* `type`\* (`string`): Type of the input following controlled vocabulary, which is related to certain UI functionalities. Currently, these types are available:
  * `file_path`: Opens up a File Open Dialog according to `validation_rules/file_extensions`.
  * `dir_path`: Opens up a Director Open Dialog.
* `default` (`string`): This specifies the default value of the associated input, e.g. one of the provided test files.
* `required`\* (`boolean`): Indicates whether the input parameter is mandatory (`true`) or optional (`false`). Set to false if it is only conditionally required based on mutual exclusivity rules.
* `validation_rules` (`object`): Validation constraints for the input parameter:
  * `file_extensions` (`array of strings`): Allowed file extensions for `file_path` type inputs. Empty array [] allows all extensions.
  * `regex_pattern` (`string`): (not implemented yet) Accepts only input files that match the Regular Expressions pattern defined here.
  * `min_size_bytes` (`string`): Accepts only input files that are larger than the value that is defined here.
* `mutex_with` (`array of strings`): List of input names that are mutually exclusive with this input. Conflicting required fields will be resolved according to the list of mutually exclusive inputs.
* **Note**: 
  * In most components, input file and input directory parameters are mutually exclusive. Use the mutex_with field to properly handle such cases by listing all mutually exclusive input fields.
  * When inputs are mutually exclusive, at least one from the group should typically be required, but individual required values can be set to false to allow the mutual exclusivity logic to handle validation.


#### Section: `outputs`\* (`array of objects`)
* `name`\* (`string`): Unique identifier for output of the component. This must follow naming conventions (lowercase, underscores allowed, no spaces, no special characters). Most commonly, these are named `output_file_n` (Single Mode, with `n` as any integer) and `output_dir` (Batch Mode).
* `label`\* (`string`): Human-readable name for this output displayed in user interfaces.
* `pattern` (`string`): This determines the pattern of the output filename. For now, only `{original_stem}` is supported as a variable, resulting in mapping the input filename without the file extension. It usually overwrites the output file naming of the component processor.
* `description` (`string`): Short description of the expected output and its content. Use > instead of | for longer descriptions (recommended).
* `category`\* (`string`): Controlled vocabulary describing the category of the output.
  * `metadata`: File containing extracted or derived metadata.
  * `validation`: File containing a report of validation processes.
* `type`\* (`string`): Type of the output file, preferably defined as a MIME-type.


#### Section: `parameter_groups` (`array of objects`)
In this section, the parameters are defined within groups. Each parameter definition can become highly complex, with interdependent value mappings and custom UI calls.

* `title`\* (`string`): Title of the Parameter Group.
* `description`\* (`string`): Description of the Parameter Group.
* `parameters`\* (`array of objects`): Here, the parameters belonging to the Parameter Group are defined. They may consist 
  * `name`\* (`string`): The identifier of the parameter, which must be unique for the component.
  * `label`\* (`string`): Human-readable name for this parameter displayed in user interfaces.
  * `type`\* (`string`): Controlled vocabulary, as this will determine the rendering within the user interface. For now, these are available, and are expected to be enhanced:
    * `string`: Simple string field.
    * `string_dropdown`: Dropdown containing a list of strings.
    * `boolean`: Simple `true`/`false` switch, oftenly used as active/inactive.
    * `integer`: Simple integer field with increase/decrease buttons.
    * `file_path`: File Path dialog, commonly used for configuration files (not intended to be input files that need to be processed).
    * `dir_path`: Directory Path dialog, commonly used for configuration files (not intended to be input files that need to be processed).
    * `column_mapping`: (to be refactored soon)
    * `value_mapping`: (to be refactored soon)
    * `schema_mapping`: (to be refactored soon)
    * `ollama_model`: This fetches a list of ollama models that are available on the defined port (default: 11434).
  * `default` (`string`): Default value for this parameter. Make sure that it matches the expected data type and structure. Leave as an empty string to be ignored.
  * `options` (`array of strings`): Available options for `string_dropdown` type parameters. Each string in the array represents a selectable value in the dropdown menu. This field should be omitted for other parameter types.
  * `description` (`string`): This is the tooltip text which should help the user to quickly understand the function of the parameter.
  * `validation_rules` (`object`): Validation constraints for the input parameter:
    * `file_extensions` (`array of strings`): Allowed file extensions for `file_path` type inputs. Empty array [] allows all extensions.
    * `regex_pattern` (`string`): (not implemented yet) Accepts only input files that match the Regular Expressions pattern defined here.
    * `min_size_bytes` (`string`): Accepts only input files that are larger than the value that is defined here.
  * `dataSource` (`object`): (**ignore**) (not yet available - currently focusing on YAML string displays - to be refactored soon) By setting the dataSource, the component is capable of using pre-defined functions of the HDP on component inputs, resulting in more complex and interdependent operations. These functions are intended to be defined in `./server_app/routes/utils.py`, and to be called by the client using the API:
    * `type` (`string`): This is the name of the pre-defined function, so it is controlled vocabulary. Currently, this includes:
      * `yaml_keys`: This provides a list of keys within a YAML, called by `/api/utils/get_yaml_keys`.
      * `yaml_subkeys`: This provides a list of subkeys within a key within a YAML.
    * `from_input`: Here, an input can be defined, e.g. a YAML file that contains the keys that shall be displayed within a string dropdown.
    * `depends_on` (`string`): Here, the key can be defined that is encoded within the file linked in `from_input`.
  * `action` (`object`):
    * `type`: This is a pre-defined action for a button next to the parameter. Currently, this is limited to:
      * `view_prompt`: Opens up a modal with text, as determined by `depends_on`.
    * `depends_on` (`array or strings`): Here, the key can be defined that determines the text/string that should be displayed within the text modal.
  * `mutex_with` (`array of strings`): List of parameter identifiers that are mutually exclusive with this parameter. Conflicting required fields will be resolved according to the list of mutually exclusive parameters; so, if one parameter is set, the other parameters that are mutually exclusive to that one will be disabled in the UI.


#### Section: `requirements`\* (`object`)
This section defines all dependencies required for the component to function properly, including Python packages, system dependencies, and hardware requirements.

* `python_environment` (`object`): Python runtime environment specifications:
    * `python_version`\* (`string`): Minimum required Python version using comparison operators (e.g., ">=3.9", ">=3.8,<3.12").
    * `packages`\* (`array of objects`): Required Python packages with detailed specifications. This will be generated automatically by the _Component Uploader_, if `requirements.txt` is provided. The Uploader will check if each package is available.
        * `name`\* (`string`): Package name as it appears in PyPI or conda repositories (be aware of common _import vs. PyPI_ mismatches).
        * `version` (`string`): Version constraint using PEP 440 syntax (e.g., ">=0.25.0", "==1.0.0", ">=2.0.0,<3.0.0").
        * `variant` (`string`): Package-specific variant identifier, most commonly used for CUDA (e.g., "cu118", "cu121").
        * `fallback_variant` (`string`): Alternative package variant when primary variant is unavailable (typically "cpu").
        * `system_dependency` (`string`): Name of system dependency required for this package to function properly. For example, this may be "cuda", "ffmpeg" or "ollama". So, this must be congruent with `system_dependencies/name` (see below).
* `system_dependencies` (`array of objects`): External system-level dependencies:
    * `name`\* (`string`): Unique identifier for the system dependency. This must be congruent with `python_environment/packages/name` (see above).
    * `version` (`string`): Required version constraint (e.g., ">=4.0", ">=11.8,<12.0").
    * `required`\* (`boolean`): Whether this dependency is mandatory (`true`) or optional (`false`).
    * `description` (`string`): Human-readable description of the dependency's purpose.
    * `type`* (`string`): Type of dependency. Valid values:
        * `package`: System package installable via package managers (e.g. _ffmpeg_).
        * `runtime`: Runtime environment or library (e.g. _cuda_).
        * `development`: Development-time dependency for compilation (e.g. _eigen3_).
        * `service`: Standalone application or service (e.g. _ollama_).
    * `install` (`object`): Installation instructions:
        * `methods`\* (`array of objects`): Platform-specific installation methods:
            * `type`* (`string`): Installation method type (e.g., "apt", "yum", "brew", "choco", "curl_script", "manual", "conda").
            * `command` (`string`): Shell command to execute for installation. For example `command: "conda install -c nvidia cuda-toolkit"`.
            * `url` (`string`): If `type` is `manual`, this contains the download URL.
            * `platforms` (`array of strings`): Compatible platforms (e.g., ["ubuntu", "debian", "centos", "rhel", "fedora", "macos", "windows", "linux"]).
        * `post_install` (`object`): Post-installation configuration:
            * `environment` (`object`): Environment variables to set (key-value pairs). For example, this may contain the key-value pair `CUDA_HOME: "/usr/local/cuda"`.
            * `services` (`array of objects`): Services to configure:
                * `name`* (`string`): Service name identifier.
                * `command`* (`string`): Command to start the service.
                * `port` (`integer`): Network port the service listens on.
    * `verify` (`object`): Verification methods to confirm successful installation:
        * `command` (`string`): Shell command to verify installation. For example, this may be `command: "nvcc --version"`.
        * `expected_pattern` (`string`): Expected pattern in command output, e.g. `expected_pattern: "release.*V11"`.
        * `file_exists` (`string`): File path that should exist after installation, for example: `file_exists: "/usr/include/eigen3/Eigen/Dense"`.
        * `service_check` (`string`): URL endpoint to verify service availability, for example, if ollama is installed correctly: `service_check: "http://localhost:11434/api/version"`.
* `system_requirements` (`object`): Hardware and system constraints, which will be determined and encoded automatically by the Component Uploader in a later version (except `gpu_memory_mb`):
    * `min_memory_mb` (`integer`): Minimum required system memory in megabytes.
    * `recommended_memory_mb` (`integer`): Recommended system memory in megabytes for optimal performance.
    * `min_disk_space_mb` (`integer`): Minimum required disk space in megabytes (of the virtual environment and system dependencies, if not already installed).
    * `gpu_memory_mb` (`integer`): Required GPU memory in megabytes when GPU acceleration (e.g. CUDA, MLX) is available.


#### Section: `execution`\* (`object`)
* `idempotent` (`boolean`): Declares if executing the same component more than one time would lead to undesired data modifications (= `false`) or not (= `true`). When set to `true`, the component can be safely re-executed without causing side effects.
* `timeout` (`integer`): This sets the timeout of the component execution in seconds, followed by the operation specified in `on_timeout`.
* `on_error` (! not implemented in 0.1.0-alpha.2 !):
  * `stop`: Stops the pipeline execution immediately when an error occurs (default).
  * `continue`: Continues the pipeline execution without any warning or notification.
  * `continue_with_warning`: CContinues the pipeline execution while logging a warning message.
  * `retry`: Attempts to re-execute the component according to retry configuration parameters.
  * `retry_n`: `n` specifies the maximum number of retry attempts when a component fails during execution. The value represents how many additional attempts will be made after the initial failure.
* `on_timeout`: (! not implemented in 0.1.0-alpha.2 !)
  * Same as `on_error` for now. It is planned to enhance this by retries with modified parameters.

## Contribution Notes
* If you want to test your Pipeline Component, simply copy it into `./pipeline_components/my_component`, and make sure that the parent directory (in this case `my_component`) matches the name within `component.yaml`. The HDP should discover it correctly and let you know if there are some validation errors during the component discovery process.
* To submit a Pipeline Component, use the _Component Uploader_, as it validates the structure, tests the component, generates the record description, publishes it to the Zenodo Community [_Heritage Data Processor Components_](https://zenodo.org/communities/hdp-components), and notifies the moderator. The moderator is then able to register it into the public component registry.
  * This registry is accessible through this endpoint: `GET https://api.modavis.org/hdp/v1/available-components`
* In the main repository, each HDP Pipeline Component is being committed as a **Git Submodule** with individual version tags. This version tag and the associated repository of a component **MUST** be congruent to the one submitted by the _Component Uploader_.
* If a default value of an input or parameter is a relative path, you are encouraged to set it using `./path/to/default_file.xyz` (starting with `./`).
* For consistency, quotation marks are only used where the string value may be misinterpreted or where a value in a specific format is being used, e.g. for _URLs_, _version tags_, within _arrays_, _pattern definitions_, _module names_, _MIME types_, _ORCID identifiers_, etc.
* It is recommended to use hyphens instead of underscores for _inputs_, _outputs_ and _parameter_ names within `component.yaml` due to command-line conventions (Unix-style). Remember that those names represent the commands that will be accesible for your HDP component.
* It is good scientific practice to always write paradata to the output / report JSON including the version and activated parameters of the used component. You may check how it is handled in the HDP Component "mtl_metadata_extractor" (pass version during class instantiation and refer it in JSON).

## Additional Notes
* Currently, mutually exclusive inputs and parameters are only working within the UI (by disabling the elements). It will not raise an error or warning if mutually exclusive inputs/parameters are used via API/CLI, as for now it is expected that expert users know what they are doing.
* As you may have noticed, this layered architecture can be partially substituted by a containerized approach, which is intentional. In an upcoming version, Docker and Singularity containers will be supported as Pipeline Components.
* In an upcoming implementation, it will be advised to provide the expected JSON structure in an additional file, as long as the corresponding output is a JSON file. This expected structure will be used to provide typehints / suggestions for the data mapping within the Pipeline Constructor in the UI.