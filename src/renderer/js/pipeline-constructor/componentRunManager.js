// src/renderer/js/pipeline-constructor/componentRunManager.js

import { PYTHON_API_BASE_URL } from '../core/api.js';
import { showToast } from '../core/ui.js';

const COMPONENT_API_BASE = `${PYTHON_API_BASE_URL}/api/pipeline_components`;

export default class ComponentRunManager {
    constructor() {
        this.currentComponent = null;
        this.isRunning = false;
        this.logSocket = null;
        this.loadedTemplateState = null;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('closeComponentRun')?.addEventListener('click', () => this.closeRunModal());
        document.getElementById('startRunBtn')?.addEventListener('click', () => this.startComponentRun());
        document.getElementById('cancelRunBtn')?.addEventListener('click', () => this.cancelComponentRun());
        document.getElementById('clearLogBtn')?.addEventListener('click', () => this.clearLog());
        document.getElementById('downloadLogBtn')?.addEventListener('click', () => this.downloadLog());
        document.getElementById('selectOutputDirBtn')?.addEventListener('click', () => this.selectOutputDirectory());
        document.getElementById('outputDirPath')?.addEventListener('input', () => this.validateInputs());

        const templateSelector = document.getElementById('runTemplateSelector');
        if (templateSelector) {
            templateSelector.addEventListener('change', async (e) => {
                const templateName = e.target.value;
                if (!templateName) {
                    this.applyTemplate(null); // Clear the form if the placeholder is selected
                    return;
                }
                try {
                    const response = await fetch(`${COMPONENT_API_BASE}/${this.currentComponent.name}/templates/${templateName}`);
                    if (!response.ok) throw new Error('Template not found or failed to load.');
                    const data = await response.json();
                    this.applyTemplate(data.parameters);
                } catch (error) {
                    showToast(`Error loading template: ${error.message}`, 'error');
                }
            });
        }

        const saveTemplateBtn = document.getElementById('saveTemplateBtn');
        if (saveTemplateBtn) {
            saveTemplateBtn.addEventListener('click', () => this.saveCurrentTemplate());
        }

        const exportTemplateBtn = document.getElementById('exportTemplateBtn');
        if (exportTemplateBtn) {
            exportTemplateBtn.addEventListener('click', () => this.exportCurrentTemplate());
        }

        const importTemplateBtn = document.getElementById('importTemplateBtn');
        if (importTemplateBtn) {
            importTemplateBtn.addEventListener('click', () => this.importTemplate());
        }
    }

    async showRunModal(component) {
        this.currentComponent = component;
        document.getElementById('runModalTitle').textContent = `Run ${component.label || component.name}`;
        document.getElementById('runComponentName').textContent = component.label || component.name;
        document.getElementById('runComponentDescription').textContent = component.description || 'No description available';
        
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipeline_components/${component.name}/config`);
            const config = await response.json();
            
            this.setupInputSelectors(component);
            this.setupParameterGroups(config.parameter_groups || []);
            this.attachDynamicParameterListeners();
            this.loadParameterTemplates();
            this.resetRunState();
            
            document.getElementById('componentRunModal').classList.remove('hidden');
            
            this.validateInputs();

        } catch (error) {
            showToast('Failed to load component configuration', 'error');
        }
    }

    /**
     * Opens a file or directory selection dialog and updates the UI with the selected path.
     * @param {object} input - The input configuration object.
     * @param {boolean} isDirectory - True if a directory should be selected, false for a file.
     */
    async selectInputFile(input, isDirectory) {
        try {
            let path;
            if (typeof window.electronAPI !== 'undefined') {
                if (isDirectory) {
                    path = await window.electronAPI.openDirectory();
                } else {
                    const extensions = input.validation_rules?.file_extensions || [];
                    const filters = extensions.length > 0 ? [{ name: 'Supported Files', extensions: extensions.map(ext => ext.replace('.', '')) }] : [];
                    filters.push({ name: 'All Files', extensions: ['*'] });
                    path = await window.electronAPI.openFile({ title: `Select ${input.name}`, filters: filters });
                }
            } else { 
                throw new Error('Electron API not available'); 
            }

            if (path) {
                const inputElement = document.getElementById(`input_${input.name.replace(/\s+/g, '_')}`);
                inputElement.value = path;
                inputElement.closest('.input-selector').classList.add('filled');
                this.validateInputs();

                // Call the centralized helper function to handle all dependent UI updates.
                this._triggerDependentUpdates(input.name, path);
            }
        } catch (error) {
            console.error('Error selecting file/directory:', error);
            showToast(`Failed to select ${isDirectory ? 'directory' : 'file'}: ${error.message}`, 'error');
            this.showManualPathInput(input, isDirectory);
        }
    }

    setupInputSelectors(component) {
        const container = document.getElementById('runInputsContainer');
        container.innerHTML = '';

        if (!component.inputs || component.inputs.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No input files required</p>';
            return;
        }

        component.inputs.forEach(input => {
            const inputDiv = document.createElement('div');
            inputDiv.className = `input-selector mb-4 ${input.required ? 'required' : ''}`;
            const inputId = `input_${input.name.replace(/\s+/g, '_')}`;
            
            let controlHtml = '';
            const isDirectory = input.type === 'dir_path';

            switch (input.type) {
                case 'string_box':
                    controlHtml = `<textarea id="${inputId}" class="file-path-input w-full p-2 border rounded" rows="4" placeholder="Enter text..."></textarea>`;
                    break;
                
                case 'file_path':
                case 'dir_path':
                    controlHtml = `
                        <div class="file-selector">
                            <input type="text" id="${inputId}" class="file-path-input" placeholder="${isDirectory ? 'Select directory...' : 'Select file...'}" readonly>
                            <button type="button" class="file-browse-btn" data-input-name="${input.name}" data-is-directory="${isDirectory}" data-extensions="${input.validation_rules?.file_extensions?.join(',') || ''}">
                                ${isDirectory ? 'Browse Folder' : 'Browse File'}
                            </button>
                        </div>
                        ${input.validation_rules?.file_extensions ? `<div class="text-xs text-gray-500 mt-1">Supported: ${input.validation_rules.file_extensions.join(', ')}</div>` : ''}
                    `;
                    break;
                
                default: // Catches 'string'
                    controlHtml = `<input type="text" id="${inputId}" class="file-path-input w-full p-2 border rounded" placeholder="Enter value...">`;
                    break;
            }

            inputDiv.innerHTML = `
                <div class="input-label">${input.label || input.name} (<code class="text-xs">${input.name}</code>) ${input.required ? '<span class="required-indicator">*</span>' : ''}</div>
                <div class="input-description">${input.description || 'No description'}</div>
                ${controlHtml}
            `;

            const browseBtn = inputDiv.querySelector('.file-browse-btn');
            if (browseBtn) {
                browseBtn.addEventListener('click', () => {
                    this.selectInputFile(input, isDirectory);
                });
            }
            
            container.appendChild(inputDiv);
        });
    }
        
    setupParameterGroups(groups) {
        const container = document.getElementById('runParametersContainer');
        container.innerHTML = ''; // Clear previous content

        if (!groups || groups.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No configurable parameters</p>';
            return;
        }

        groups.forEach(group => {
            const fieldset = document.createElement('fieldset');
            fieldset.className = 'parameter-group border-t pt-4 mt-4';
            // Add dependency data attribute if it exists
            if (group.depends_on_input) {
                fieldset.dataset.dependsOnInput = group.depends_on_input;
                fieldset.classList.add('hidden'); // Hide conditional groups initially
            }

            let fieldsetHTML = `
                <legend class="text-md font-semibold text-gray-700">${group.title}</legend>
                <p class="text-sm text-gray-500 mb-4">${group.description || ''}</p>
            `;
            
            group.parameters.forEach(param => {
                // Use the existing buildParameterInput function, but a new case is added to it.
                fieldsetHTML += this.buildParameterInput(param); 
            });

            fieldset.innerHTML = fieldsetHTML;
            container.appendChild(fieldset);
        });

        // Now, attach event listeners to any special widgets we created
        this.attachParameterWidgetListeners();
    }

    buildParameterInput(param) {
        const { name, label, type, help_text, default: defaultValue, dataSource, action } = param;
        let controlHtml = '';
        const inputId = `param_${name}`;

        // Use the user-friendly label, but include the technical name in a <code> tag for clarity
        const labelHtml = `<label for="${inputId}" class="block text-sm font-medium text-gray-700">${label || name} (<code class="text-xs">${name}</code>)</label>`;
        const helpHtml = help_text ? `<div class="parameter-help text-xs text-gray-500 mt-1">${help_text}</div>` : '';
        let actionButtonHtml = '';

        // FIX #2: Create the "View Prompt" button if an action is defined
        if (action?.type === 'view_prompt') {
            actionButtonHtml = `<button type="button" class="btn-secondary-xs view-prompt-btn ml-2" data-param-name="${name}">View</button>`;
        }

        // This switch statement handles all parameter types correctly
        switch (type) {
            case 'bool':
                controlHtml = `<div class="mt-1"><input type="checkbox" id="${inputId}" class="parameter-control rounded" ${defaultValue ? 'checked' : ''}></div>`;
                break;

            case 'string_dropdown':
            case 'ollama_model':
                const dataSourceAttr = dataSource ? `data-source='${JSON.stringify(dataSource)}'` : '';
                const dataTypeAttr = type === 'ollama_model' ? `data-type="ollama_model"` : '';
                controlHtml = `<select id="${inputId}" class="parameter-control mt-1 block w-full p-2 border rounded-md bg-white" ${dataSourceAttr} ${dataTypeAttr}><option value="">- Loading -</option></select>`;
                break;

            case 'column_mapping':
                return `
                    <div class="parameter-input" data-param-name="${name}">
                        <div class="flex items-center">${labelHtml}</div>
                        <div class="mt-2 flex items-center gap-2">
                            <button type="button" class="btn-secondary configure-column-mapping-btn text-sm" data-param-name="${name}">
                                Configure Manually
                            </button>
                            <button type="button" class="btn-primary automap-columns-btn text-sm" data-param-name="${name}">
                                Automap
                            </button>
                            </div>
                        <div id="mapping_summary_${name}" class="text-xs text-green-700 mt-1">Not configured.</div>
                        <input type="hidden" id="param_${name}" class="parameter-control">
                        ${helpHtml}
                    </div>
                `;

            case 'data_mapping':
                return `
                    <div class="parameter-input" data-param-name="${name}">
                        <div class="flex items-center">${labelHtml}</div>
                        <div class="mt-2 flex items-center gap-2">
                            <button type="button" class="btn-primary configure-data-mapping-btn text-sm" data-param-name="${name}">
                                Configure Data Mapping
                            </button>
                        </div>
                        <div id="mapping_summary_${name}" class="text-xs text-green-700 mt-1">Not configured.</div>
                        <input type="hidden" id="param_${name}" class="parameter-control">
                        ${helpHtml}
                    </div>
                `;

            case 'schema_mapping':
                return `
                    <div class="parameter-input" data-param-name="${name}">
                        <div class="flex items-center">${labelHtml}</div>
                        <div class="mt-2 flex items-center gap-2">
                            <button type="button" class="btn-primary configure-schema-mapping-btn text-sm" data-param-name="${name}">
                                Configure Value Mapping
                            </button>
                        </div>
                        <div id="mapping_summary_${name}" class="text-xs text-green-700 mt-1">Not configured.</div>
                        <input type="hidden" id="param_${name}" class="parameter-control">
                        ${helpHtml}
                    </div>
                `;

            default: // Covers 'string', 'int', 'float', etc.
                const inputType = (type === 'int' || type === 'float') ? 'number' : 'text';
                const stepAttr = type === 'float' ? 'step="0.1"' : '';
                controlHtml = `<input type="${inputType}" id="${inputId}" class="parameter-control mt-1 block w-full p-2 border rounded-md" value="${defaultValue || ''}" ${stepAttr}>`;
                break;
        }

        // Assemble the final HTML for all standard parameters
        return `
            <div class="parameter-input" data-param-name="${name}">
                <div class="flex items-center">${labelHtml} ${actionButtonHtml}</div>
                ${controlHtml}
                <div id="suggestion_${name}" class="text-xs text-blue-600 mt-1"></div>
                ${helpHtml}
            </div>
        `;
    }

    async startComponentRun() {
        if (!this.validateInputs()) {
            showToast('Please fill in all required fields', 'warning');
            return;
        }
        
        // Collect inputs
        const inputs = {};
        if (this.currentComponent.inputs) {
            this.currentComponent.inputs.forEach(input => {
                const inputElement = document.getElementById(`input_${input.name.replace(/\s+/g, '_')}`);
                inputs[input.name] = inputElement.value;
            });
        }
        
        // Collect parameters
        const parameters = {};
        const paramElements = document.querySelectorAll('[id^="param_"]');
        paramElements.forEach(element => {
            const paramName = element.id.replace('param_', '');
            let value = element.type === 'checkbox' ? element.checked : element.value;
            
            // Handle list parameters
            if (element.type === 'text' && element.value.includes(',')) {
                value = element.value.split(',').map(v => v.trim()).filter(v => v);
            }
            
            parameters[paramName] = value;
        });
        
        const outputDir = document.getElementById('outputDirPath').value;
        
        // Start execution
        this.setRunningState(true);
        this.addLogMessage('info', 'Starting component execution...');
        
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/components/${this.currentComponent.name}/run`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inputs: inputs,
                    parameters: parameters,
                    output_directory: outputDir
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to start component');
            }
            
            const result = await response.json();
            this.addLogMessage('success', `Component started successfully. Execution ID: ${result.execution_id}`);
            
            // Start log streaming
            this.startLogStreaming(result.execution_id);
            
        } catch (error) {
            this.addLogMessage('error', `Failed to start component: ${error.message}`);
            this.setRunningState(false);
        }
    }

    async startLogStreaming(executionId) {
        try {
            // Use Server-Sent Events for log streaming
            const eventSource = new EventSource(`${PYTHON_API_BASE_URL}/api/components/logs/${executionId}`);
            
            eventSource.onmessage = (event) => {
                const logData = JSON.parse(event.data);
                this.addLogMessage(logData.level, logData.message, logData.timestamp);
                
                if (logData.status === 'completed' || logData.status === 'failed') {
                    this.setRunningState(false);
                    eventSource.close();
                    
                    if (logData.status === 'completed') {
                        this.addLogMessage('success', '✅ Component execution completed successfully');
                        showToast('Component execution completed', 'success');
                    } else {
                        this.addLogMessage('error', '❌ Component execution failed');
                        showToast('Component execution failed', 'error');
                    }
                }
            };
            
            eventSource.onerror = () => {
                this.addLogMessage('error', 'Lost connection to log stream');
                this.setRunningState(false);
                eventSource.close();
            };
            
            this.logSocket = eventSource;
            
        } catch (error) {
            this.addLogMessage('error', `Failed to start log streaming: ${error.message}`);
            this.setRunningState(false);
        }
    }

    closeRunModal() {
        if (this.isRunning) {
            const confirm = window.confirm('Component is still running. Are you sure you want to close?');
            if (!confirm) return;
            
            this.cancelComponentRun();
        }
        
        document.getElementById('componentRunModal').classList.add('hidden');
        this.currentComponent = null;
    }

    cancelComponentRun() {
        if (this.logSocket) {
            this.logSocket.close();
        }
        
        this.addLogMessage('warning', 'Component execution cancelled by user');
        this.setRunningState(false);
        showToast('Component execution cancelled', 'info');
    }

    setRunningState(isRunning) {
        this.isRunning = isRunning;
        
        const startBtn = document.getElementById('startRunBtn');
        const cancelBtn = document.getElementById('cancelRunBtn');
        const statusText = document.getElementById('runStatusText');
        const statusIndicator = document.querySelector('.status-indicator');
        const logLoader = document.getElementById('logLoader');
        
        if (isRunning) {
            startBtn.classList.add('hidden');
            cancelBtn.classList.remove('hidden');
            statusText.textContent = 'Running...';
            if (statusIndicator) statusIndicator.className = 'status-indicator running';
            logLoader.classList.remove('hidden');
        } else {
            startBtn.classList.remove('hidden');
            cancelBtn.classList.add('hidden');
            statusText.textContent = 'Ready to run';
            if (statusIndicator) statusIndicator.className = 'status-indicator ready';
            logLoader.classList.add('hidden');
        }
    }

    addLogMessage(level, message, timestamp = null) {
        const logContent = document.getElementById('componentRunLog');
        const time = timestamp || new Date().toLocaleTimeString();
        const logLine = `[${time}] ${level.toUpperCase()}: ${message}\n`;
        
        logContent.textContent += logLine;
        logContent.scrollTop = logContent.scrollHeight;
        
        // Add CSS class for styling
        const lastLine = logContent.textContent.split('\n').slice(-2, -1)[0];
        if (lastLine) {
            // This is a simple approach
        }
    }

    clearLog() {
        document.getElementById('componentRunLog').textContent = '';
    }
    
    downloadLog() {
        const logContent = document.getElementById('componentRunLog').textContent;
        const blob = new Blob([logContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentComponent.name}_execution_log.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    resetRunState() {
        this.setRunningState(false);
        this.clearLog();
        document.getElementById('outputDirPath').value = '';
        
        // Clear input selectors
        document.querySelectorAll('.input-selector').forEach(selector => {
            selector.classList.remove('filled');
            const input = selector.querySelector('.file-path-input');
            if (input) input.value = '';
        });
    }

    async selectOutputDirectory() {
        try {
            let path;
            
            if (typeof window.electronAPI !== 'undefined' && typeof window.electronAPI.openDirectory === 'function') {
                path = await window.electronAPI.openDirectory();
            } else {
                throw new Error('Directory selection not available');
            }

            if (path) {
                document.getElementById('outputDirPath').value = path;
                this.validateInputs();
                console.log('Selected output directory:', path);
            } else {
                console.log('Directory selection cancelled by user');
            }
        } catch (error) {
            console.error('Error selecting output directory:', error);
            showToast(`Failed to select directory: ${error.message}`, 'error');
            
            // Fallback: allow manual input
            const outputInput = document.getElementById('outputDirPath');
            outputInput.removeAttribute('readonly');
            outputInput.placeholder = 'Enter output directory path manually...';
            outputInput.focus();
            
            showToast('Directory dialog not available. Please enter path manually.', 'info');
        }
    }

    showManualPathInput(input, isDirectory) {
        const inputElement = document.getElementById(`input_${input.name.replace(/\s+/g, '_')}`);
        inputElement.removeAttribute('readonly');
        inputElement.placeholder = `Enter ${isDirectory ? 'directory' : 'file'} path manually...`;
        inputElement.focus();
        
        showToast('File dialog not available. Please enter path manually.', 'info');
    }
    
    validateInputs() {
        const startBtn = document.getElementById('startRunBtn');
        let isValid = true;

        if (!this.currentComponent) {
            console.error("validateInputs called but currentComponent is null. Aborting validation.");
            if (startBtn) startBtn.disabled = true;
            return false;
        }
        
        // Check required inputs
        if (this.currentComponent.inputs) {
            this.currentComponent.inputs.forEach(input => {
                if (input.required) {
                    const inputElement = document.getElementById(`input_${input.name.replace(/\s+/g, '_')}`);
                    if (!inputElement.value.trim()) {
                        isValid = false;
                    }
                }
            });
        }
        
        // Check output directory
        const outputDir = document.getElementById('outputDirPath').value.trim();
        if (!outputDir) {
            isValid = false;
        }
        
        startBtn.disabled = !isValid;
        return isValid;
    }

    async loadParameterTemplates(selectAfterLoad = null) {
        const selector = document.getElementById('runTemplateSelector');
        const currentValue = selectAfterLoad || selector.value.replace(' *', '');
        
        selector.innerHTML = '<option value="">- Load Template -</option>';
        this.loadedTemplateState = null; // Reset dirty state

        if (!this.currentComponent) return;

        try {
            const response = await fetch(`${COMPONENT_API_BASE}/${this.currentComponent.name}/templates`);
            if (!response.ok) return;

            const data = await response.json();
            if (data.success && data.templates) {
                data.templates.forEach(name => {
                    const isSelected = name === currentValue ? 'selected' : '';
                    selector.innerHTML += `<option value="${name}" ${isSelected}>${name}</option>`;
                });
            }
        } catch (e) {
            console.error("Failed to load templates:", e);
        }
    }

    async applyTemplate(parameters) {
        const clearFields = () => {
            // This function clears all inputs and parameters
            document.querySelectorAll('.parameter-control, #runInputsContainer .file-path-input, #outputDirPath').forEach(el => {
                const inputName = el.id.replace('param_', '').replace('input_', '');
                if (el.type === 'checkbox') {
                    el.checked = false;
                } else {
                    el.value = '';
                }
                this._triggerDependentUpdates(inputName, '');
            });
            this.loadedTemplateState = null;
            const selector = document.getElementById('runTemplateSelector');
            if (selector) selector.value = '';
        };

        if (!parameters) {
            clearFields();
            return;
        }
        
        // Clear the form to ensure a clean state before applying the new template
        clearFields();

        // Set all non-dependent values first. This is a robust way to handle simple fields.
        for (const [key, value] of Object.entries(parameters)) {
            if (key === 'prompt_id' || key === 'prompt_key' || key === 'fallback_prompt_key') {
                continue; // Skip dependent dropdowns; they will be handled sequentially below.
            }
            const inputElement = document.getElementById(`param_${key}`) || document.getElementById(`input_${key}`) || (key === 'output_directory' ? document.getElementById('outputDirPath') : null);
            if (inputElement) {
                inputElement.value = value;
                this._triggerDependentUpdates(key, value); // Update visibility for fields like table_column_mapping
            }
        }

        // --- Handle the dependent dropdown chain sequentially ---
        try {
            const promptsFile = parameters['prompts_file_path'];
            if (promptsFile) {
                const promptIdDropdown = document.getElementById('param_prompt_id');
                if (promptIdDropdown) {
                    // 1. Await the population of the first dropdown.
                    await this.handlePromptFileChange(promptIdDropdown, promptsFile);
                    
                    // 2. Now that its <option>s exist, safely set its value from the template.
                    promptIdDropdown.value = parameters['prompt_id'] || '';

                    // 3. If a prompt_id was successfully set, its 'change' event (dispatched
                    //    from handlePromptFileChange) will have already triggered the population
                    //    of the next dropdowns. Waiting via 'microtask' delay.
                    await Promise.resolve(); 

                    // 4. Now, safely set the values for the final dropdowns.
                    const promptKeyDropdown = document.getElementById('param_prompt_key');
                    const fallbackKeyDropdown = document.getElementById('param_fallback_prompt_key');

                    if(promptKeyDropdown) {
                        promptKeyDropdown.value = parameters['prompt_key'] || '';
                    }
                    if(fallbackKeyDropdown) {
                        fallbackKeyDropdown.value = parameters['fallback_prompt_key'] || '';
                    }
                }
            }
        } catch (e) {
            showToast(`Error applying template dependencies: ${e.message}`, 'error');
        }
        
        // Final state update
        this.loadedTemplateState = JSON.stringify(this.collectParameters());
        this.updateTemplateDirtyState();
        showToast("Template loaded successfully.", "success");
    }

    collectParameters() {
        const data = {};
        
        // Collect regular parameters
        document.querySelectorAll('.parameter-control').forEach(element => {
            const paramName = element.id.replace('param_', '');
            if (element.type === 'checkbox') {
                data[paramName] = element.checked;
            } else if (element.value) {
                data[paramName] = element.value;
            }
        });

        // Collect main inputs (file paths, text boxes)
        document.querySelectorAll('#runInputsContainer .file-path-input').forEach(element => {
            const inputName = element.id.replace('input_', '');
            if (element.value) {
                data[inputName] = element.value;
            }
        });
        
        // --- Explicitly collect the output directory ---
        const outputDir = document.getElementById('outputDirPath');
        if (outputDir && outputDir.value) {
            data['output_directory'] = outputDir.value;
        }

        return data;
    }

    async saveCurrentTemplate() {
        const modal = document.getElementById('saveTemplateModal');
        const nameInput = document.getElementById('templateNameInput');
        const confirmBtn = document.getElementById('confirmSaveTemplateBtn');
        const cancelBtn = document.getElementById('cancelSaveTemplateBtn');

        nameInput.value = '';
        modal.classList.remove('hidden');
        nameInput.focus();

        const handleSave = async () => {
            const templateName = nameInput.value.trim();
            if (!templateName) {
                showToast("Template name cannot be empty.", "warning");
                return;
            }

            const parameters = this.collectParameters();

            try {
                const response = await fetch(`${COMPONENT_API_BASE}/${this.currentComponent.name}/templates`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ template_name: templateName, parameters: parameters })
                });
                const result = await response.json();
                if (!result.success) throw new Error(result.error);

                showToast(`Template "${templateName}" saved.`, 'success');
                await this.loadParameterTemplates(templateName); 
                
                this.loadedTemplateState = JSON.stringify(parameters);
                this.updateTemplateDirtyState();

            } catch (e) {
                showToast(`Error saving template: ${e.message}`, 'error');
            } finally {
                modal.classList.add('hidden');
            }
        };

        const cleanConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(cleanConfirmBtn, confirmBtn);
        cleanConfirmBtn.addEventListener('click', handleSave, { once: true });

        cancelBtn.onclick = () => modal.classList.add('hidden');
    }

    exportCurrentTemplate() {
        const parameters = this.collectParameters();
        // Simple manual YAML generation to avoid heavy dependencies
        let yamlString = "parameters:\n";
        for (const [key, value] of Object.entries(parameters)) {
            yamlString += `  ${key}: ${JSON.stringify(value)}\n`;
        }

        const blob = new Blob([yamlString], { type: 'application/x-yaml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.currentComponent.name}_template.yaml`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    importTemplate() {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '.yaml,.yml';
        
        fileInput.onchange = e => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                const content = event.target.result;
                try {
                    const newName = file.name.replace(/\.yaml$|\.yml$/i, "");
                    const parameters = { yaml_content: content };
                    
                    // This is a simplified regex approach.
                    const parsedParams = {};
                    content.split('\n').forEach(line => {
                        const match = line.match(/^\s*([^#\s][^:]*):\s*(.*)\s*$/);
                        if (match) {
                            try {
                                parsedParams[match[1].trim()] = JSON.parse(match[2].trim());
                            } catch {
                                parsedParams[match[1].trim()] = match[2].trim();
                            }
                        }
                    });
                    
                    const response = await fetch(`${COMPONENT_API_BASE}/${this.currentComponent.name}/templates`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ template_name: newName, parameters: parsedParams })
                    });

                    const result = await response.json();
                    if (!result.success) throw new Error(result.error);
                    
                    showToast(`Template "${newName}" imported successfully.`, 'success');
                    this.loadParameterTemplates();

                } catch (err) {
                    showToast(`Failed to import template: ${err.message}`, 'error');
                }
            };
            reader.readAsText(file);
        };
        
        fileInput.click();
    }

    updateTemplateDirtyState() {
        const selector = document.getElementById('runTemplateSelector');
        if (!selector.value || !this.loadedTemplateState) return; // No template loaded

        const currentState = JSON.stringify(this.collectParameters());
        const isDirty = currentState !== this.loadedTemplateState;

        const selectedOption = selector.options[selector.selectedIndex];
        
        // Add or remove the asterisk based on the dirty state
        if (isDirty && !selectedOption.text.endsWith(' *')) {
            selectedOption.text += ' *';
        } else if (!isDirty) {
            selectedOption.text = selectedOption.text.replace(' *', '');
        }
    }

    /**
     * Centralized function to trigger UI updates based on an input's new value.
     */
    _triggerDependentUpdates(inputName, newValue) {
        // 1. Update dependent dropdowns (for prompts)
        if (inputName === 'prompts_file_path') {
            const promptIdDropdown = document.getElementById('param_prompt_id');
            if (promptIdDropdown) {
                this.handlePromptFileChange(promptIdDropdown, newValue);
            }
        }

        // 2. Update visibility of conditional parameter groups
        const dependentGroup = document.querySelector(`.parameter-group[data-depends-on-input="${inputName}"]`);
        if (dependentGroup) {
            dependentGroup.classList.toggle('hidden', !newValue);
        }
    }

    attachDynamicParameterListeners() {
        // Listener for the content viewer modal
        document.getElementById('closeContentViewerModal')?.addEventListener('click', 
            () => document.getElementById('contentViewerModal').classList.add('hidden'));

        // Find all dynamic elements and attach handlers
        document.querySelectorAll('[data-source]').forEach(el => {
            const sourceInfo = JSON.parse(el.dataset.source);
            if (sourceInfo.depends_on) {
                const sourceDropdown = document.getElementById(`param_${sourceInfo.depends_on}`);
                sourceDropdown.addEventListener('change', () => this.handlePromptIdChange(el, sourceDropdown.value));
            }
        });

        document.querySelectorAll('[data-type="ollama_model"]').forEach(el => {
            this.populateOllamaModels(el);
        });

        document.querySelectorAll('.view-prompt-btn').forEach(button => {
            button.addEventListener('click', (e) => this.openPromptViewerModal(e.target.dataset.paramName));
        });
    }

    async handlePromptFileChange(targetDropdown, filePath) {
        targetDropdown.innerHTML = '<option value="">Loading...</option>';
        if (!filePath) {
            targetDropdown.innerHTML = '<option value="">- Select Prompt File -</option>';
            // Manually trigger change to clear dependent dropdowns
            targetDropdown.dispatchEvent(new Event('change'));
            return;
        }
        
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/utils/get_yaml_keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: filePath })
            });
            if (!response.ok) throw new Error('Failed to fetch keys from YAML.');
            
            const { keys } = await response.json();
            targetDropdown.innerHTML = '<option value="">- Select Prompt Set -</option>';
            keys.forEach(key => targetDropdown.innerHTML += `<option value="${key}">${key}</option>`);
        } catch (e) {
            targetDropdown.innerHTML = `<option value="">${e.message}</option>`;
        } finally {
            // Programmatically trigger the change event
            // to update any dropdowns that depend on this one.
            targetDropdown.dispatchEvent(new Event('change'));
        }
    }

    async handlePromptIdChange(targetDropdown, selectedId) {
        // Best Practice: Check if the target element exists before proceeding.
        if (!targetDropdown) return; 

        targetDropdown.innerHTML = '<option value="">Loading...</option>';
        const sourceInput = document.getElementById('input_prompts_file_path');
        
        if (!selectedId || !sourceInput || !sourceInput.value) {
            targetDropdown.innerHTML = '<option value="">- Select Prompt Set First -</option>';
            return;
        }

        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/utils/get_yaml_keys`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_path: sourceInput.value, parent_key: selectedId })
            });
            if (!response.ok) throw new Error('Failed to fetch sub-keys.');

            const { keys } = await response.json();
            targetDropdown.innerHTML = '';
            if (keys.length > 0) {
                keys.forEach(key => targetDropdown.innerHTML += `<option value="${key}">${key}</option>`);
            } else {
                targetDropdown.innerHTML = '<option value="">- No Sub-keys -</option>';
            }
        } catch (e) {
            targetDropdown.innerHTML = `<option value="">${e.message}</option>`;
        }
    }

    async populateOllamaModels(selectElement) {
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/utils/list_ollama_models`);
            const result = await response.json();
            if (result.success) {
                selectElement.innerHTML = '';
                result.models.forEach(modelName => selectElement.innerHTML += `<option value="${modelName}">${modelName}</option>`);
            } else {
                selectElement.innerHTML = `<option value="">${result.error}</option>`;
                selectElement.disabled = true;
            }
        } catch (e) {
            selectElement.innerHTML = '<option value="">Error connecting to server</option>';
            selectElement.disabled = true;
        }
    }

    async openPromptViewerModal(paramName) {
        const modal = document.getElementById('contentViewerModal');
        const title = document.getElementById('contentViewerTitle');
        const body = document.getElementById('contentViewerBody');

        // Gather the actual selected values from the UI
        const promptsFile = document.getElementById('input_prompts_file_path').value;
        const promptId = document.getElementById('param_prompt_id').value;
        
        // Get the dropdown that was clicked and find its selected value
        const promptKeyDropdown = document.getElementById(`param_${paramName}`);
        const promptKeyValue = promptKeyDropdown.value;

        if (!promptsFile || !promptId || !promptKeyValue) {
            showToast('Please select a prompt file, a prompt set, and a prompt key first.', 'warning');
            return;
        }
        
        title.textContent = `Viewing Prompt: ${promptId} -> ${promptKeyValue}`;
        body.innerHTML = 'Loading prompt content...';
        modal.classList.remove('hidden');

        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/utils/get_prompt_content`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Send the correct selected value to the backend
                body: JSON.stringify({ file_path: promptsFile, prompt_id: promptId, prompt_key: promptKeyValue })
            });
            const data = await response.json();

            if (!data.success) throw new Error(data.error);

            body.innerHTML = `
                <div>
                    <h4 class="font-semibold text-gray-800 mb-1">System Prompt</h4>
                    <pre class="text-xs bg-gray-100 p-3 rounded-md whitespace-pre-wrap">${data.system}</pre>
                </div>
                <div>
                    <h4 class="font-semibold text-gray-800 mb-1">User Prompt</h4>
                    <pre class="text-xs bg-gray-100 p-3 rounded-md whitespace-pre-wrap">${data.user}</pre>
                </div>
            `;
            
            const suggestionEl = document.getElementById('suggestion_model');
            if (suggestionEl) {
            suggestionEl.textContent = data.suggested_model ? `💡 Suggested: ${data.suggested_model}` : '';
            }

        } catch(e) {
            body.innerHTML = `<p class="text-red-500">Error: ${e.message}</p>`;
        }
    }

    async openColumnMappingModal(paramName) {
        const modal = document.getElementById('columnMappingModal');
        const tableBody = document.getElementById('mappingTableBody');
        const modalTitle = document.getElementById('columnMappingTitle');

        // Find dependent inputs
        const paramGroup = document.querySelector(`.parameter-input[data-param-name="${paramName}"]`).closest('.parameter-group');
        const dependentInputName = paramGroup.dataset.dependsOnInput;
        const tableInput = document.getElementById(`input_${dependentInputName.replace(/\s+/g, '_')}`);
        const promptsFileInput = document.getElementById('input_prompts_file_path');
        const promptIdDropdown = document.getElementById('param_prompt_id');

        // Validate that all necessary preceding inputs are filled
        if (!tableInput || !tableInput.value) {
            showToast(`Please select a file for '${dependentInputName}' before configuring the mapping.`, 'warning');
            return;
        }
        if (!promptsFileInput || !promptsFileInput.value || !promptIdDropdown || !promptIdDropdown.value) {
            showToast(`Please select a Prompts File and a Prompt Set first.`, 'warning');
            return;
        }

        modalTitle.textContent = `Configure Column Mapping`;
        tableBody.innerHTML = '<tr><td colspan="2" class="text-center p-4">Loading...</td></tr>';
        modal.classList.remove('hidden');

        try {
            // Fetch both table headers and prompt placeholders concurrently
            const [headersResponse, placeholdersResponse] = await Promise.all([
                fetch(`${PYTHON_API_BASE_URL}/api/utils/get_table_headers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_path: tableInput.value })
                }),
                fetch(`${PYTHON_API_BASE_URL}/api/utils/get_prompt_placeholders`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_path: promptsFileInput.value, prompt_id: promptIdDropdown.value })
                })
            ]);

            if (!headersResponse.ok || !placeholdersResponse.ok) {
                throw new Error('Failed to fetch required data for mapping.');
            }

            const { headers } = await headersResponse.json();
            const { placeholders } = await placeholdersResponse.json();

            tableBody.innerHTML = ''; // Clear loading message

            if (placeholders.length === 0) {
                tableBody.innerHTML = '<tr><td colspan="2" class="text-center p-4">No {placeholders} found in the selected prompts.</td></tr>';
                return;
            }
            
            // Get existing mapping to pre-fill dropdowns
            const hiddenInput = document.getElementById(`param_${paramName}`);
            let existingMapping = {};
            try {
                if (hiddenInput.value) existingMapping = JSON.parse(hiddenInput.value);
            } catch (e) { /* ignore malformed JSON */ }

            // Create a row for each detected placeholder
            placeholders.forEach(ph => {
                this.addMappingRow(tableBody, headers, ph, existingMapping[ph]);
            });
            
            // Setup modal buttons
            document.getElementById('saveMappingBtn').onclick = () => this.saveColumnMapping(paramName);
            document.getElementById('closeMappingModal').onclick = () => modal.classList.add('hidden');

        } catch (error) {
            tableBody.innerHTML = `<tr><td colspan="2" class="text-center p-4 text-red-500">Error: ${error.message}</td></tr>`;
        }
    }

    /**
     * Dynamically adds a new row to the mapping table in the modal.
     */
    addMappingRow(tableBody, headers, placeholder = '', selectedColumn = '') {
        const row = tableBody.insertRow();
        row.innerHTML = `
            <td class="p-2 align-middle">
                <input type="text" class="mapping-placeholder w-full p-2 border rounded bg-gray-100 font-mono" value="${placeholder}" readonly>
            </td>
            <td class="p-2 align-middle">
                <select class="mapping-column w-full p-2 border rounded bg-white">
                    <option value="">- Select Column -</option>
                    ${headers.map(h => `<option value="${h}" ${h === selectedColumn ? 'selected' : ''}>${h}</option>`).join('')}
                </select>
            </td>
        `;
    }

    /**
     * Gathers data from the mapping modal, stringifies it as JSON, and saves it to the hidden input.
     */
    saveColumnMapping(paramName) {
        const tableBody = document.getElementById('mappingTableBody');
        const mapping = {};
        let isValid = true;

        tableBody.querySelectorAll('tr').forEach(row => {
            const placeholder = row.querySelector('.mapping-placeholder').value.trim();
            const column = row.querySelector('.mapping-column').value;

            if (placeholder && column) {
                mapping[placeholder] = column;
            } else if (placeholder || column) {
                // If one is filled but not the other, it's an error
                isValid = false;
            }
        });

        if (!isValid) {
            showToast('Each mapping row must have both a placeholder and a selected column.', 'warning');
            return;
        }

        const hiddenInput = document.getElementById(`param_${paramName}`);
        hiddenInput.value = JSON.stringify(mapping, null, 2);

        // Update summary text
        const summaryEl = document.getElementById(`mapping_summary_${paramName}`);
        const count = Object.keys(mapping).length;
        summaryEl.textContent = `${count} column(s) mapped.`;
        
        document.getElementById('columnMappingModal').classList.add('hidden');
        showToast('Column mapping saved!', 'success');
    }

    async handleAutomap(paramName) {
        // 1. Gather all necessary inputs
        const tableInput = document.getElementById('input_table_file_path');
        const promptsFileInput = document.getElementById('input_prompts_file_path');
        const promptIdDropdown = document.getElementById('param_prompt_id');

        if (!tableInput?.value || !promptsFileInput?.value || !promptIdDropdown?.value) {
            showToast("Please select a table file, prompts file, and prompt set before automapping.", "warning");
            return;
        }

        showToast("Attempting to automap columns...", "info");

        try {
            // 2. Call the new backend endpoint
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/utils/automap_columns`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    table_path: tableInput.value,
                    prompts_path: promptsFileInput.value,
                    prompt_id: promptIdDropdown.value
                })
            });

            const result = await response.json();
            if (!result.success) throw new Error(result.error);

            // 3. Apply the mapping to the hidden input and update the UI
            const hiddenInput = document.getElementById(`param_${paramName}`);
            hiddenInput.value = JSON.stringify(result.mapping || {}, null, 2);

            const summaryEl = document.getElementById(`mapping_summary_${paramName}`);
            const count = Object.keys(result.mapping || {}).length;
            summaryEl.textContent = `Automapped ${count} column(s).`;
            
            showToast(`Successfully automapped ${count} columns.`, 'success');

        } catch (e) {
            showToast(`Automap failed: ${e.message}`, 'error');
        }
    }

    async openDataMappingModal(paramName, contextData) {
        const modal = document.getElementById('dataMappingModal');
        const tableBody = document.getElementById('dataMappingModalBody');
        const modalTitle = document.getElementById('dataMappingTitle');
        modalTitle.textContent = 'Configure Zenodo Data Mapping';
        tableBody.innerHTML = '<div class="p-4 text-center">Loading...</div>';
        modal.classList.remove('hidden');

        try {
            if (!window.zenodoMappingSchema) {
                const response = await fetch(`${PYTHON_API_BASE_URL}/api/metadata/mapping_schema_details`);
                if (!response.ok) throw new Error("Could not load Zenodo metadata schema.");
                window.zenodoMappingSchema = await response.json();
            }
            const zenodoFields = window.zenodoMappingSchema.standard_fields.map(f => ({ key: f.key, label: f.label }));

            const dataInputs = {};
            let headers = [];

            // CONTEXT-AWARE LOGIC
            if (contextData.context === 'run') {
                const batchMappingFile = document.getElementById('input_mapping_file')?.value;
                for (let i = 1; i <= 5; i++) {
                    const inputEl = document.getElementById(`input_data_input_${i}`);
                    if (inputEl && inputEl.value) {
                        dataInputs[`data_input_${i}`] = { path: inputEl.value, enabled: true };
                    }
                }
                if (batchMappingFile) {
                    const headersResponse = await fetch(`${PYTHON_API_BASE_URL}/api/utils/get_table_headers`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file_path: batchMappingFile })
                    });
                    if (headersResponse.ok) {
                        const headersData = await headersResponse.json();
                        if (headersData.success) headers = headersData.headers;
                    }
                }
            } else if (contextData.context === 'constructor') {
                const step = window.pipelineConstructor.findStepById(contextData.stepId);
                if (step && step.inputMapping) {
                    for (const componentInputName in step.inputMapping) {
                        if (componentInputName.startsWith('data_input_')) {
                        dataInputs[componentInputName] = { enabled: true, path: null }; // Enabled for mapping, but no path to fetch keys from.
                        }
                    }
                }
                // Headers remain empty in constructor context.
            }

            tableBody.innerHTML = `
                <table class="w-full text-sm">
                    <thead><tr class="bg-gray-100">
                        <th class="p-2 text-left w-1/3">Zenodo Field</th>
                        <th class="p-2 text-left w-1/4">Mapping Source</th>
                        <th class="p-2 text-left">Value / Key / Column</th>
                    </tr></thead>
                    <tbody id="dataMappingTableBody"></tbody>
                </table>`;
            const dataMappingTable = document.getElementById('dataMappingTableBody');

            const hiddenInput = document.getElementById(`param_${paramName}`);
            let existingMapping = {};
            try {
                if (hiddenInput.value) existingMapping = JSON.parse(hiddenInput.value);
            } catch (e) { /* ignore */ }

            zenodoFields.forEach(field => {
                this.addDataMappingRow(dataMappingTable, field, headers, dataInputs, existingMapping[field.key], contextData.context);
            });

            document.getElementById('saveDataMappingBtn').onclick = () => this.saveDataMapping(paramName);
            document.getElementById('closeDataMappingModal').onclick = () => modal.classList.add('hidden');

        } catch (error) {
            tableBody.innerHTML = `<div class="p-4 text-center text-red-500">Error: ${error.message}</div>`;
        }
    }

    addDataMappingRow(tableBody, field, headers, dataInputs, existingValue, context) {
        const row = tableBody.insertRow();
        row.className = "border-b";
        row.dataset.fieldKey = field.key;

        let sourceOptions = '<option value="literal">Literal Value</option>';
        if (headers.length > 0) {
            sourceOptions += '<option value="column">Column</option>';
        }
        for (let i = 1; i <= 5; i++) {
            const inputKey = `data_input_${i}`;
            const isEnabled = !!dataInputs[inputKey]; // Check for presence
            sourceOptions += `<option value="${inputKey}" ${!isEnabled ? 'disabled' : ''}>Data Input ${i}${!isEnabled ? ' (Not Mapped)' : ''}</option>`;
        }

        const selectedType = existingValue?.type || 'literal';

        row.innerHTML = `
            <td class="p-2 align-middle font-medium text-gray-700">${field.label}</td>
            <td class="p-2 align-middle">
                <select class="mapping-type-select w-full p-1.5 border rounded bg-white text-xs">
                    ${sourceOptions}
                </select>
            </td>
            <td class="p-2 align-middle value-cell"></td>`;

        const typeSelector = row.querySelector('.mapping-type-select');
        typeSelector.value = selectedType;

        const updateCallback = (e) => this.updateDataMappingValueInput(row, e.target.value, headers, dataInputs, null, context);
        typeSelector.addEventListener('change', updateCallback);

        // Initial render of the value cell
        this.updateDataMappingValueInput(row, selectedType, headers, dataInputs, existingValue, context);
    }

    async updateDataMappingValueInput(row, selectedType, headers, dataInputs, existingValue, context) {
        const valueCell = row.querySelector('.value-cell');
        valueCell.innerHTML = '';
        const prefilledValue = existingValue?.value || '';

        if (selectedType === 'literal') {
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'w-full p-1.5 border rounded text-xs mapping-value-input';
            input.placeholder = 'Enter fixed value...';
            input.value = existingValue?.type === 'literal' ? prefilledValue : '';
            valueCell.appendChild(input);
        } else if (selectedType === 'column' && headers.length > 0) {
            const select = document.createElement('select');
            select.className = 'w-full p-1.5 border rounded bg-white text-xs mapping-value-input';
            select.innerHTML = '<option value="">- Select Column -</option>' + 
                headers.map(h => `<option value="${h}" ${existingValue?.type === 'column' && prefilledValue === h ? 'selected' : ''}>${h}</option>`).join('');
            valueCell.appendChild(select);
        } else if (selectedType.startsWith('data_input_')) {
            // Differentiate behavior based on context
            if (context === 'run') {
                const filePath = dataInputs[selectedType]?.path;
                const select = document.createElement('select');
                select.className = 'w-full p-1.5 border rounded bg-white text-xs mapping-value-input';
                select.innerHTML = '<option>Loading keys...</option>';
                valueCell.appendChild(select);

                try {
                    const response = await fetch(`${PYTHON_API_BASE_URL}/api/utils/get_json_keys`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ file_path: filePath })
                    });
                    const result = await response.json();
                    if (!result.success) throw new Error(result.error);

                    select.innerHTML = '<option value="">- Select Key -</option>' + 
                        result.keys.map(k => `<option value="${k}" ${existingValue?.type === selectedType && prefilledValue === k ? 'selected' : ''}>${k}</option>`).join('');
                } catch (error) {
                    select.innerHTML = `<option value="">Error: ${error.message}</option>`;
                }
            } else { // context === 'constructor'
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'w-full p-1.5 border rounded text-xs mapping-value-input';
                input.placeholder = 'Enter JSON key path (e.g., key.subKey)';
                input.value = (existingValue?.type === selectedType) ? prefilledValue : '';
                valueCell.appendChild(input);
            }
        }
    }

    saveDataMapping(paramName) {
        const tableBody = document.getElementById('dataMappingTableBody');
        const mapping = {};

        tableBody.querySelectorAll('tr').forEach(row => {
            const zenodoField = row.dataset.fieldKey;
            const type = row.querySelector('.mapping-type-select').value;
            const valueInput = row.querySelector('.mapping-value-input');

            if (zenodoField && valueInput && valueInput.value) {
                mapping[zenodoField] = {
                    type: type,
                    value: valueInput.value
                };
            }
        });

        const hiddenInput = document.getElementById(`param_${paramName}`);
        hiddenInput.value = JSON.stringify(mapping, null, 2);

        const summaryEl = document.getElementById(`mapping_summary_${paramName}`);
        const count = Object.keys(mapping).length;
        summaryEl.textContent = `${count} field(s) mapped.`;
        
        document.getElementById('dataMappingModal').classList.add('hidden');
        showToast('Data mapping saved!', 'success');
    }

    async openSchemaMappingModal(paramName) {
        const modal = document.getElementById('schemaMappingModal');
        const tableBody = document.getElementById('schemaMappingModalBody');
        const modalTitle = document.getElementById('schemaMappingTitle');

        const templateFileInput = document.getElementById('param_template_file');
        const mappingFileInput = document.getElementById('input_mapping_file');
        const schemaDirInput = document.getElementById('param_schema_dir');

        if (!templateFileInput || !templateFileInput.value) {
            showToast('Please select a Template File before configuring mapping.', 'warning');
            return;
        }
        if (!schemaDirInput || !schemaDirInput.value) {
            showToast('Please specify the Schema Directory before configuring mapping.', 'warning');
            return;
        }

        modalTitle.textContent = 'Configure Value Mapping';
        tableBody.innerHTML = '<div class="p-4 text-center">Discovering template variables and vocabularies...</div>';
        modal.classList.remove('hidden');

        try {
            // A single, powerful API call to get all info at once
            const mappingInfoPromise = fetch(`${PYTHON_API_BASE_URL}/api/utils/get_template_mapping_info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    template_file: templateFileInput.value,
                    schema_dir: schemaDirInput.value
                })
            });

            // Fetch table headers in parallel if a mapping file is selected
            const headersPromise = (mappingFileInput && mappingFileInput.value)
                ? fetch(`${PYTHON_API_BASE_URL}/api/utils/get_table_headers`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ file_path: mappingFileInput.value })
                })
                : Promise.resolve(null);

            const [mappingInfoResponse, headersResponse] = await Promise.all([mappingInfoPromise, headersPromise]);

            if (!mappingInfoResponse.ok) throw new Error('Failed to analyze template and schemas.');
            
            const mappingInfo = await mappingInfoResponse.json();
            if (!mappingInfo.success) throw new Error(mappingInfo.error);

            let headers = [];
            if (headersResponse && headersResponse.ok) {
                const headersData = await headersResponse.json();
                if (headersData.success) headers = headersData.headers;
            }
            
            const placeholders = mappingInfo.variables || [];
            
            tableBody.innerHTML = `
                <table class="w-full text-sm">
                    <thead>
                        <tr class="bg-gray-100">
                            <th class="p-2 text-left w-1/3">Template Variable</th>
                            <th class="p-2 text-left w-1/4">Mapping Type</th>
                            <th class="p-2 text-left">Value / Column</th>
                        </tr>
                    </thead>
                    <tbody id="schemaMappingTableBody"></tbody>
                </table>
            `;
            const schemaMappingTable = document.getElementById('schemaMappingTableBody');

            if (placeholders.length === 0) {
                schemaMappingTable.innerHTML = '<tr><td colspan="3" class="text-center p-4">No variables like ${...} found in the template file.</td></tr>';
                return;
            }
            
            const hiddenInput = document.getElementById(`param_${paramName}`);
            let existingMapping = {};
            try {
                if (hiddenInput.value) existingMapping = JSON.parse(hiddenInput.value);
            } catch (e) { /* ignore */ }

            // The placeholder object now contains all the info we need
            placeholders.forEach(phObject => {
                this.addSchemaMappingRow(schemaMappingTable, headers, phObject, existingMapping[phObject.name]);
            });
            
            document.getElementById('saveSchemaMappingBtn').onclick = () => this.saveSchemaMapping(paramName);
            document.getElementById('closeSchemaMappingModal').onclick = () => modal.classList.add('hidden');

        } catch (error) {
            tableBody.innerHTML = `<div class="p-4 text-center text-red-500">Error: ${error.message}</div>`;
        }
    }

    addSchemaMappingRow(tableBody, headers, placeholderObject, existingValue) {
        const row = tableBody.insertRow();
        row.className = "border-b";

        const hasMappingFile = headers.length > 0;
        const { name, has_vocab, vocab_values } = placeholderObject;

        const selectedType = existingValue?.type || (has_vocab ? 'vocabulary' : 'literal');

        row.innerHTML = `
            <td class="p-2 align-middle font-mono text-xs">${name}</td>
            <td class="p-2 align-middle">
                <select class="mapping-type-select w-full p-1.5 border rounded bg-white text-xs">
                    <option value="literal" ${selectedType === 'literal' ? 'selected' : ''}>Literal Value</option>
                    <option value="column" ${selectedType === 'column' ? 'selected' : ''} ${!hasMappingFile ? 'disabled' : ''}>
                        Column ${!hasMappingFile ? '(No File)' : ''}
                    </option>
                    ${has_vocab ? `<option value="vocabulary" ${selectedType === 'vocabulary' ? 'selected' : ''}>Controlled Vocabulary</option>` : ''}
                </select>
            </td>
            <td class="p-2 align-middle value-cell"></td>
        `;

        const typeSelector = row.querySelector('.mapping-type-select');
        const valueCell = row.querySelector('.value-cell');

        const updateValueInput = (selected) => {
            valueCell.innerHTML = '';
            const prefilledValue = existingValue?.value || '';

            if (selected === 'literal') {
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'w-full p-1.5 border rounded text-xs mapping-value-input';
                input.placeholder = 'Enter fixed value...';
                input.value = existingValue?.type === 'literal' ? prefilledValue : '';
                valueCell.appendChild(input);

            } else if (selected === 'column' && hasMappingFile) {
                const select = document.createElement('select');
                select.className = 'w-full p-1.5 border rounded bg-white text-xs mapping-value-input';
                select.innerHTML = '<option value="">- Select Column -</option>' + 
                    headers.map(h => `<option value="${h}" ${existingValue?.type === 'column' && prefilledValue === h ? 'selected' : ''}>${h}</option>`).join('');
                valueCell.appendChild(select);
            
            } else if (selected === 'vocabulary' && has_vocab) {
                // NO API CALL NEEDED HERE ANYMORE!
                const select = document.createElement('select');
                select.className = 'w-full p-1.5 border rounded bg-white text-xs mapping-value-input';
                select.innerHTML = '<option value="">- Select Value -</option>' +
                    vocab_values.map(v => `<option value="${v}" ${existingValue?.type === 'vocabulary' && prefilledValue === v ? 'selected' : ''}>${v}</option>`).join('');
                valueCell.appendChild(select);
            }
        };

        typeSelector.addEventListener('change', (e) => updateValueInput(e.target.value));
        updateValueInput(selectedType);
    }

    saveSchemaMapping(paramName) {
        const tableBody = document.getElementById('schemaMappingTableBody');
        const mapping = {};
        let isValid = true;

        tableBody.querySelectorAll('tr').forEach(row => {
            const placeholder = row.cells[0].textContent.trim();
            const type = row.querySelector('.mapping-type-select').value;
            const valueInput = row.querySelector('.mapping-value-input');

            if (placeholder && valueInput && valueInput.value) {
                mapping[placeholder] = {
                    type: type,
                    value: valueInput.value
                };
            }
        });

        const hiddenInput = document.getElementById(`param_${paramName}`);
        hiddenInput.value = JSON.stringify(mapping, null, 2);

        const summaryEl = document.getElementById(`mapping_summary_${paramName}`);
        const count = Object.keys(mapping).length;
        summaryEl.textContent = `${count} variable(s) mapped.`;
        
        document.getElementById('schemaMappingModal').classList.add('hidden');
        showToast('Mapping saved!', 'success');
    }

    /**
     * Attaches event listeners for special parameter widgets, like our new mapping button.
     */
    attachParameterWidgetListeners() {
        document.querySelectorAll('.configure-column-mapping-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const paramName = e.target.dataset.paramName;
                this.openColumnMappingModal(paramName);
            });
        });

        document.querySelectorAll('.automap-columns-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const paramName = e.target.dataset.paramName;
                this.handleAutomap(paramName);
            });
        });

        document.querySelectorAll('.configure-data-mapping-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const paramName = e.target.dataset.paramName;
                this.openDataMappingModal(paramName, { context: 'run' });
            });
        });

        document.querySelectorAll('.configure-schema-mapping-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const paramName = e.target.dataset.paramName;
                this.openSchemaMappingModal(paramName);
            });
        });
    }
}