// src/renderer/js/pipeline-constructor/constructor.js

import { navigateToView } from '../core/navigation.js';
import { showToast } from '../core/ui.js';
import { PYTHON_API_BASE_URL } from '../core/api.js';
import { zenodoMappingSchema } from '../core/state.js';
import { showConfigModal, showInfoModal } from '../views/pipelineComponents.js';
import { openMetadataMappingModal } from '../wizards/metadataMappingWizard.js'

// --- Constants ---
const MODALITY_OPTIONS = [
    "Image / Photography", "3D Model", "Audio", "Video",
    "Text / Document", "Software", "Structured Information", "Multimodal Dataset",
];
const COMPONENT_API_BASE = `${PYTHON_API_BASE_URL}/api/pipeline_components`;

// --- Main Class ---
export default class PipelineConstructor {
    constructor() {
        this.currentPipeline = null;
        this.pipelines = [];
        this.availableComponents = [];
        this.fileCounter = { image: 0, model: 0, audio: 0, video: 0, document: 0, data: 0 };
        this.complexFieldInstanceCounter = 0;
        this.init();
    }

    async init() {
        await this.loadAvailableComponents();
        await this.loadExistingPipelines();
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Ensure we're working with the correct instance
        console.log('Setting up pipeline constructor event listeners');
        
        // Main header button listener
        const headerBtn = document.getElementById('pipelineConstructorBtn');
        if (headerBtn) {
            headerBtn.addEventListener('click', () => {
                console.log('Header button clicked - navigating to pipeline constructor');
                navigateToView('pipeline-constructor');
                this.initializeMainView();
            });
        }

        // Main view buttons
        const newBtn = document.getElementById('newPipelineMainBtn');
        if (newBtn) {
            newBtn.addEventListener('click', () => {
                console.log('New pipeline button clicked');
                this.showNewPipelineModal();
            });
        }

        const startBtn = document.getElementById('startConstructorBtn');
        if (startBtn) {
            startBtn.addEventListener('click', () => {
                console.log('Start constructor button clicked');
                this.showNewPipelineModal();
            });
        }

        const importBtn = document.getElementById('importPipelineMainBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                console.log('Import pipeline button clicked');
                this.importPipelineYAML();
            });
        }

        // Pipeline selector
        const selector = document.getElementById('existingPipelineMainSelect');
        const duplicateBtn = document.getElementById('duplicatePipelineBtn');
        if (selector) {
            selector.addEventListener('change', (e) => {
                const pipelineId = e.target.value;
                // --- Enable/disable duplicate button based on selection ---
                if (duplicateBtn) {
                    duplicateBtn.disabled = !pipelineId;
                }
                if (pipelineId) {
                    console.log('Loading pipeline:', pipelineId);
                    this.loadPipeline(pipelineId);
                }
            });
        }

        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', () => {
                if (!duplicateBtn.disabled) {
                    this.duplicateCurrentPipeline();
                }
            });
        }

        // Modal form listeners
        const form = document.getElementById('newPipelineForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createNewPipeline();
            });
        }

        // Modal close listeners
        const closeButtons = ['closeNewPipeline', 'cancelNewPipeline', 'closeComponentSelector'];
        closeButtons.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.addEventListener('click', () => {
                    if (id.includes('NewPipeline')) {
                        this.hideNewPipelineModal();
                    } else if (id.includes('ComponentSelector')) {
                        this.hideComponentSelector();
                    }
                });
            }
        });

        // Auto-generate identifier
        const nameInput = document.getElementById('pipelineName');
        if (nameInput) {
            nameInput.addEventListener('input', (e) => {
                const identifier = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '_')
                    .replace(/_+/g, '_')
                    .replace(/^_|_$/g, '');
                const identifierInput = document.getElementById('pipelineIdentifier');
                if (identifierInput) {
                    identifierInput.value = identifier;
                }
            });
        }

        console.log('Pipeline constructor event listeners setup complete');
    }

    async duplicateCurrentPipeline() {
        if (!this.currentPipeline) {
            showToast("No pipeline selected to duplicate.", "warning");
            return;
        }

        // 1. Find the next available number for the default name
        let counter = 2;
        let newName, newIdentifier;
        do {
            newName = `${this.currentPipeline.name} (${counter})`;
            newIdentifier = newName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
            counter++;
        } while (this.pipelines.find(p => p.identifier === newIdentifier));

        // 2. Get references to the modal and its elements
        const modal = document.getElementById('duplicatePipelineModal');
        const nameInput = document.getElementById('newPipelineNameInput');
        const confirmBtn = document.getElementById('confirmDuplicateBtn');
        const cancelBtn = document.getElementById('cancelDuplicateBtn');
        const closeBtn = document.getElementById('closeDuplicatePipelineModal');

        // 3. Populate the modal with the default name
        nameInput.value = newName;

        // 4. Set up event listeners for the modal buttons
        // We use .cloneNode(true) to easily remove any previous listeners
        const cleanConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(cleanConfirmBtn, confirmBtn);

        cleanConfirmBtn.onclick = async () => {
            const finalName = nameInput.value.trim();
            if (!finalName) {
                showToast("Pipeline name cannot be empty.", "error");
                return;
            }

            const finalIdentifier = finalName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
            if (this.pipelines.find(p => p.identifier === finalIdentifier)) {
                showToast(`A pipeline with the identifier '${finalIdentifier}' already exists.`, "error");
                return;
            }

            // Create a deep copy and update properties
            const duplicatedPipeline = JSON.parse(JSON.stringify(this.currentPipeline));
            duplicatedPipeline.name = finalName;
            duplicatedPipeline.identifier = finalIdentifier;
            delete duplicatedPipeline.pipeline_id;
            duplicatedPipeline.created = new Date().toISOString();
            duplicatedPipeline.lastModified = new Date().toISOString();
            duplicatedPipeline.execution_count = 0;
            delete duplicatedPipeline.last_executed_timestamp;

            try {
                const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(duplicatedPipeline)
                });
                if (!response.ok) throw new Error('Failed to save duplicated pipeline.');

                await this.loadExistingPipelines(); // Refresh the pipeline list
                
                // Select and load the newly created pipeline
                const dropdown = document.getElementById('existingPipelineMainSelect');
                if (dropdown) {
                    dropdown.value = finalIdentifier;
                    dropdown.dispatchEvent(new Event('change'));
                }

                showToast(`Pipeline "${finalName}" created successfully!`, 'success');
                modal.classList.add('hidden'); // Close modal on success
            } catch (error) {
                console.error('Error duplicating pipeline:', error);
                showToast(error.message, 'error');
            }
        };
        
        const closeModal = () => modal.classList.add('hidden');
        cancelBtn.onclick = closeModal;
        closeBtn.onclick = closeModal;

        // 5. Show the modal
        modal.classList.remove('hidden');
    }

    findStepById(stepId) {
        if (!this.currentPipeline || !this.currentPipeline.steps) {
            return null;
        }
        return this.currentPipeline.steps.find(s => s.id === stepId);
    }

    initializeMainView() {
        this.loadExistingPipelines();
        this.updatePipelineSelector();
    }

    loadPipelineInMainView(identifier) {
        const pipeline = this.pipelines.find(p => p.identifier === identifier);
        if (pipeline) {
            this.currentPipeline = { ...pipeline };
            this.renderPipelineInMainView();
        }
    }

    async loadAvailableComponents() {
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipeline_components`);
            const data = await response.json();
            
            this.availableComponents = [];
            Object.keys(data).forEach(category => {
                if (category !== 'metadata') {
                    data[category].forEach(component => {
                        this.availableComponents.push({
                            ...component,
                            category: category
                        });
                    });
                }
            });
        } catch (error) {
            console.error('Failed to load components:', error);
        }
    }

    showNewPipelineModal() {
        const modalitySelect = document.getElementById('pipelineModality');
        if (modalitySelect) {
            modalitySelect.innerHTML = '<option value="">Select modality...</option>'; // Clear existing options
            MODALITY_OPTIONS.forEach(modality => {
                const option = document.createElement('option');
                option.value = modality;
                option.textContent = modality;
                modalitySelect.appendChild(option);
            });
        }

        document.getElementById('newPipelineModal').classList.remove('hidden');
        document.getElementById('newPipelineForm').reset();
    }

    hideNewPipelineModal() {
        document.getElementById('newPipelineModal').classList.add('hidden');
    }

    async createNewPipeline() {
        this.fileCounter = { image: 0, model: 0, audio: 0, video: 0, document: 0, data: 0 };
        
        const formData = new FormData(document.getElementById('newPipelineForm'));
        const pipelineData = {
            name: formData.get('pipelineName') || document.getElementById('pipelineName').value,
            identifier: document.getElementById('pipelineIdentifier').value,
            processingMode: formData.get('processingMode'),
            modality: document.getElementById('pipelineModality').value,
            description: '',
            notes: document.getElementById('pipelineNotes').value,
            version: '1.0.0',
            status: 'draft',
            zenodoDraftStepEnabled: true,
            description_constructor_enabled: false,
            description_template: '',
            steps: [],
            created: new Date().toISOString()
        };


        // Validate unique identifier
        if (this.pipelines.find(p => p.identifier === pipelineData.identifier)) {
            alert('Identifier already exists. Please choose a different one.');
            return;
        }

        this.hideNewPipelineModal();
        
        try {
            // Create new pipeline by sending it to the backend
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pipelineData)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to create pipeline');
            }

            const result = await response.json();
            
            if (result.success) {
                showToast(`Pipeline "${pipelineData.name}" created successfully!`, 'success');

                // Reload all pipelines from the backend to get the canonical version.
                await this.loadExistingPipelines();

                // Select the new pipeline in the dropdown.
                const dropdown = document.getElementById('existingPipelineMainSelect');
                if (dropdown) {
                    dropdown.value = pipelineData.identifier;
                }

                // Properly load the newly created pipeline. This will render the UI.
                await this.loadPipeline(pipelineData.identifier);

                // If the newly loaded pipeline has no steps, add the initial one.
                if (this.currentPipeline && this.currentPipeline.steps.length === 0) {
                    this.addInitialStep();
                }

                // After creation and loading, the pipeline is in a saved state.
                this.clearModifiedState();

            } else {
                throw new Error(result.error || "Server indicated failure.");
            }
            
        } catch (error) {
            console.error('Error creating new pipeline:', error);
            showToast(`Error creating pipeline: ${error.message}`, 'warning');
        }
    }

    renderBuilderUI() {
        const container = document.getElementById('pipelineConstructorMainView');
        if (!container) {
            console.error("Pipeline constructor main view container not found!");
            return;
        }

        // Prepend the new "Initial Step" for Zenodo Draft Creation
        container.innerHTML = `
            <div class="pipeline-info-header mb-6">
                <div class="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div>
                        <span class="text-sm font-medium text-gray-600">Pipeline:</span>
                        <span id="currentPipelineName" class="ml-2 font-semibold text-gray-800">${this.currentPipeline.name}</span>
                    </div>
                    <div>
                        <span class="text-sm font-medium text-gray-600">Modality:</span>
                        <span class="ml-2 font-semibold text-gray-800">${this.currentPipeline.modality}</span>
                    </div>
                </div>
            </div>

            <div id="initialStepContainer" class="pipeline-step initial-step">
                <div class="initial-step-header">
                    <h4 class="step-title">Zenodo Draft Creation</h4>
                    <div class="step-toggle">
                        <label class="switch">
                            <input type="checkbox" id="toggleZenodoStep">
                            <span class="slider round"></span>
                        </label>
                        <span>Enabled</span>
                    </div>
                </div>
                <div class="initial-step-content">
                    <div class="status-indicators">
                        <div id="zenodoConfigStatus">Loading status...</div>
                        <div id="zenodoOverwriteStatus" class="hidden">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.636-1.236 2.37-1.236 3.006 0l5.429 10.519c.636 1.236-.302 2.631-1.503 2.631H4.331c-1.2 0-2.139-1.395-1.503-2.631L8.257 3.099zM9 13a1 1 0 112 0 1 1 0 01-2 0zm1-3a1 1 0 00-1 1v1a1 1 0 102 0v-1a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>
                            <span>Warning: A later step may override this configuration.</span>
                        </div>
                    </div>
                    <div class="card-actions">
                        <button id="configureZenodoMetadataBtn" class="btn-primary">
                            Configure Zenodo Metadata
                        </button>
                    </div>
                </div>
            </div>
            <div id="pipelineStepsContainer" class="pipeline-steps-container mb-6"></div>

            <div class="add-step-container mb-6">
                <button id="addStepBtn" class="add-step-btn">
                    <span class="text-2xl">+</span>
                    <span>Add Processing Step</span>
                </button>
            </div>

            <div id="descriptionConstructorStepContainer" class="pipeline-step description-constructor-step">
                <div class="initial-step-header">
                    <h4 class="step-title">Description Constructor</h4>
                    <div class="step-toggle">
                        <label class="switch">
                            <input type="checkbox" id="toggleDescriptionConstructorStep">
                            <span class="slider round"></span>
                        </label>
                        <span>Enabled</span>
                    </div>
                </div>
                <div class="initial-step-content">
                    <div class="status-indicators">
                        <div id="descriptionConstructorStatus">Loading status...</div>
                    </div>
                    <div class="card-actions">
                        <button id="openDescriptionConstructorBtn" class="btn-primary">
                            Open Description Constructor
                        </button>
                    </div>
                </div>
            </div>

            <div id="finalStepContainer" class="pipeline-step final-step">
                <div class="initial-step-header">
                    <h4 class="step-title">Step: File Upload</h4>
                    <div class="step-toggle">
                        <label class="switch">
                            <input type="checkbox" id="toggleZenodoUploadStep">
                            <span class="slider round"></span>
                        </label>
                        <span>Enabled</span>
                    </div>
                </div>
                <div class="initial-step-content">
                    <div class="status-indicators">
                        <div id="zenodoUploadStatus">Loading status...</div>
                    </div>
                    <div class="card-actions">
                        <p class="text-xs text-gray-500 p-2">If enabled, all source and generated files will be uploaded to the Zenodo draft.</p>
                    </div>
                </div>
            </div>

            <div id="publishStepContainer" class="pipeline-step publish-step">
                <div class="initial-step-header">
                    <h4 class="step-title">Final Step: Publish</h4>
                    <div class="step-toggle">
                        <label class="switch">
                            <input type="checkbox" id="toggleZenodoPublishStep">
                            <span class="slider round"></span>
                        </label>
                        <span>Disabled</span>
                    </div>
                </div>
                <div class="initial-step-content">
                    <div class="status-indicators">
                        <div id="zenodoPublishStatus">Loading status...</div>
                    </div>
                    <div class="card-actions">
                        <p class="text-xs text-gray-500 p-2">If enabled, all drafts containing uploaded files will be published.</p>
                    </div>
                </div>
            </div>

            <div class="pipeline-actions border-t pt-6">
                <div class="flex justify-center gap-4">
                    <button id="savePipelineBtn" class="btn-primary flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 3.75V16.5L12 14.25 7.5 16.5V3.75m9 0H18A2.25 2.25 0 0120.25 6v12A2.25 2.25 0 0118 20.25H6A2.25 2.25 0 013.75 18V6A2.25 2.25 0 016 3.75h1.5m9 0h-9"></path></svg>
                        Save Pipeline
                    </button>
                    <button id="exportPipelineBtn" class="btn-secondary flex items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-4 h-4 mr-1"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"></path></svg>
                        Export YAML
                    </button>
                </div>
            </div>
        `;

        // Attach event handlers for the new buttons
        document.getElementById('addStepBtn').addEventListener('click', () => this.addPipelineStep());
        document.getElementById('savePipelineBtn').addEventListener('click', () => this.savePipeline());
        document.getElementById('exportPipelineBtn').addEventListener('click', () => this.exportPipelineYAML());

        // Attach event handlers for the initial step
        document.getElementById('configureZenodoMetadataBtn').addEventListener('click', () => {
            openMetadataMappingModal(true); // Call with isReconfigure = true
        });
        document.getElementById('toggleZenodoStep').addEventListener('change', (e) => {
            if(this.currentPipeline) {
                this.currentPipeline.zenodoDraftStepEnabled = e.target.checked;
                this.markAsModified();
                this.updateInitialStepStatus();
            }
        });

        document.getElementById('toggleZenodoUploadStep').addEventListener('change', (e) => {
            if(this.currentPipeline) {
                this.currentPipeline.zenodoUploadStepEnabled = e.target.checked;
                this.markAsModified();
                this.updateFinalStepStatus();
            }
        });

        document.getElementById('toggleZenodoPublishStep').addEventListener('change', (e) => {
            if(this.currentPipeline) {
                this.currentPipeline.zenodoPublishStepEnabled = e.target.checked;
                this.markAsModified();
                this.updatePublishStepStatus();
            }
        });

        document.getElementById('openDescriptionConstructorBtn').addEventListener('click', () => {
            this.showDescriptionConstructorModal();
        });
        document.getElementById('toggleDescriptionConstructorStep').addEventListener('change', (e) => {
            if (this.currentPipeline) {
                this.currentPipeline.description_constructor_enabled = e.target.checked;
                this.markAsModified();
                this.updateDescriptionConstructorStatus();
            }
        });

        // Update the status of the initial step based on current data
        this.updateInitialStepStatus();
        this.updateDescriptionConstructorStatus();
        this.updateFinalStepStatus();
        this.updatePublishStepStatus();

        // Render the processing steps for the current pipeline
        const stepsContainer = document.getElementById('pipelineStepsContainer');
        if (stepsContainer && this.currentPipeline.steps) {
            this.currentPipeline.steps.forEach(step => this.renderStep(step));
        }
    }

    updateDescriptionConstructorStatus() {
        if (!document.getElementById('descriptionConstructorStepContainer') || !this.currentPipeline) return;

        const statusEl = document.getElementById('descriptionConstructorStatus');
        const toggleEl = document.getElementById('toggleDescriptionConstructorStep');
        const openBtn = document.getElementById('openDescriptionConstructorBtn');

        const isEnabled = !!this.currentPipeline.description_constructor_enabled;
        toggleEl.checked = isEnabled;
        openBtn.disabled = !isEnabled;

        const hasTemplate = this.currentPipeline.description_template && this.currentPipeline.description_template.trim() !== '';

        if (hasTemplate) {
            statusEl.textContent = '✅ Template Configured';
            statusEl.className = 'text-green-700 font-semibold';
        } else {
            statusEl.textContent = '⚠️ Template Not Configured';
            statusEl.className = 'text-amber-600 font-semibold';
        }
    }

    showDescriptionConstructorModal() {
        const modal = document.getElementById('descriptionConstructorModal');
        const textarea = document.getElementById('descriptionTemplateTextarea');
        const suggestions = document.getElementById('descriptionVariableSuggestions');

        textarea.value = this.currentPipeline.description_template || '';
        modal.classList.remove('hidden');

        const getAvailableSuggestions = () => {
            const outputs = new Map();
            // Add Zenodo Metadata as a static first option
            outputs.set('zenodo_metadata', {
                id: 'zenodo_metadata',
                name: 'Zenodo Metadata',
                sourceInfo: 'Pre-existing Record Data' // Add context for this special item
            });

            this.currentPipeline.steps.forEach(step => {
                const sourceInfo = `Step ${step.stepNumber}: ${step.component?.label || 'Unnamed Component'}`;
                (step.outputs || []).forEach(output => {
                    if (!outputs.has(output.id)) {
                        // Store the output along with its source information
                        outputs.set(output.id, { ...output, sourceInfo: sourceInfo });
                    }
                });
            });
            return Array.from(outputs.values());
        };

        const showSuggestions = (filter = '') => {
            const availableSuggestions = getAvailableSuggestions();
            suggestions.innerHTML = '';
            const filtered = availableSuggestions.filter(o => o.name.toLowerCase().includes(filter.toLowerCase()));

            if (filtered.length === 0) {
                suggestions.classList.add('hidden');
                return;
            }

            filtered.forEach(item => {
                const suggestionDiv = document.createElement('div');
                suggestionDiv.className = 'suggestion-item';
                suggestionDiv.innerHTML = `
                    <span class="suggestion-name">${item.name}</span>
                    <span class="suggestion-source">(${item.sourceInfo})</span>
                `;
                suggestionDiv.onclick = () => {
                    if (item.id === 'zenodo_metadata') {
                        this.showZenodoKeyPrompt((key) => {
                            if (key) {
                                const placeholder = `\${zenodo_metadata.${key}}`;
                                this.insertPlaceholderIntoTextarea(textarea, placeholder);
                            }
                        });
                    } else {
                        const placeholder = `\${${item.id}}`;
                        this.insertPlaceholderIntoTextarea(textarea, placeholder);
                    }
                    suggestions.classList.add('hidden');
                };
                suggestions.appendChild(suggestionDiv);
            });
            suggestions.classList.remove('hidden');
        };

        textarea.onkeyup = (e) => {
            const cursorPos = e.target.selectionStart;
            const text = e.target.value;

            if (text[cursorPos - 1] === '@') {
                showSuggestions();
            } else {
                suggestions.classList.add('hidden');
            }
        };

        document.getElementById('saveDescriptionTemplateBtn').onclick = () => this.saveDescriptionTemplate();
        document.getElementById('closeDescriptionConstructorModal').onclick = () => this.hideDescriptionConstructorModal();
    }

    insertPlaceholderIntoTextarea(textarea, placeholder) {
        const cursorPos = textarea.selectionStart;
        const text = textarea.value;
        const pre = text.substring(0, cursorPos - 1); // -1 to replace the '@'
        const post = text.substring(cursorPos);
        textarea.value = pre + placeholder + post;
        textarea.focus();
    }

    showZenodoKeyPrompt(callback) {
        const modal = document.getElementById('zenodoKeyPromptModal');
        const input = document.getElementById('zenodoKeyInput');
        const confirmBtn = document.getElementById('confirmZenodoKeyPromptBtn');
        const cancelBtn = document.getElementById('cancelZenodoKeyPromptBtn');
        const closeBtn = document.getElementById('closeZenodoKeyPromptModal');

        input.value = ''; // Reset input
        modal.classList.remove('hidden');
        input.focus();

        const handleConfirm = () => {
            const key = input.value.trim();
            modal.classList.add('hidden');
            callback(key);
            cleanup();
        };

        const handleCancel = () => {
            modal.classList.add('hidden');
            callback(null);
            cleanup();
        };

        const handleKeydown = (e) => {
            if (e.key === 'Enter') {
                handleConfirm();
            } else if (e.key === 'Escape') {
                handleCancel();
            }
        };

        // Use cloneNode to ensure we have a fresh button without old listeners
        const cleanConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(cleanConfirmBtn, confirmBtn);
        
        // Add new event listeners
        cleanConfirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        closeBtn.addEventListener('click', handleCancel);
        input.addEventListener('keydown', handleKeydown);

        // Cleanup function to remove listeners after use
        function cleanup() {
            cleanConfirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            closeBtn.removeEventListener('click', handleCancel);
            input.removeEventListener('keydown', handleKeydown);
        }
    }

    hideDescriptionConstructorModal() {
        document.getElementById('descriptionConstructorModal').classList.add('hidden');
    }

    saveDescriptionTemplate() {
        const textarea = document.getElementById('descriptionTemplateTextarea');
        this.currentPipeline.description_template = textarea.value;
        this.markAsModified();
        this.updateDescriptionConstructorStatus();
        this.hideDescriptionConstructorModal();
        showToast('Description template saved!', 'success');
    }

    updateInitialStepStatus() {
        if (!document.getElementById('initialStepContainer') || !this.currentPipeline) return;

        const configStatusEl = document.getElementById('zenodoConfigStatus');
        const overwriteStatusEl = document.getElementById('zenodoOverwriteStatus');
        const toggleEl = document.getElementById('toggleZenodoStep');
        const configBtn = document.getElementById('configureZenodoMetadataBtn');

        // Set the toggle state
        const isEnabled = !!this.currentPipeline.zenodoDraftStepEnabled;
        toggleEl.checked = isEnabled;
        configBtn.disabled = !isEnabled;

        // Check if metadata mapping is configured on the pipeline object
        const mapping = this.currentPipeline.metadata_mapping;
        const hasMapping = mapping && Object.keys(mapping).length > 0;

        if (hasMapping) {
            configStatusEl.textContent = '✅ Metadata Configured';
            configStatusEl.className = 'text-green-700 font-semibold';
        } else {
            configStatusEl.textContent = '⚠️ Metadata Not Configured';
            configStatusEl.className = 'text-amber-600 font-semibold';
        }

        // Check for overwrites from other steps
        let isOverwritten = false;
        if (this.currentPipeline.steps) {
            for (const step of this.currentPipeline.steps) {
                if (step.outputs?.some(o => o.outputMapping?.mapToZenodo === true)) {
                    isOverwritten = true;
                    break;
                }
            }
        }
        overwriteStatusEl.classList.toggle('hidden', !isOverwritten || !hasMapping);
    }

    updateFinalStepStatus() {
        if (!document.getElementById('finalStepContainer') || !this.currentPipeline) return;

        const uploadStatusEl = document.getElementById('zenodoUploadStatus');
        const toggleEl = document.getElementById('toggleZenodoUploadStep');
        const isEnabled = !!this.currentPipeline.zenodoUploadStepEnabled;

        toggleEl.checked = isEnabled;

        if (isEnabled) {
            uploadStatusEl.textContent = '✅ Upload Enabled';
            uploadStatusEl.className = 'text-green-700 font-semibold';
        } else {
            uploadStatusEl.textContent = '⏸️ Upload Disabled';
            uploadStatusEl.className = 'text-gray-500 font-semibold';
        }
    }

    updatePublishStepStatus() {
        if (!document.getElementById('publishStepContainer') || !this.currentPipeline) return;

        const publishStatusEl = document.getElementById('zenodoPublishStatus');
        const toggleEl = document.getElementById('toggleZenodoPublishStep');
        const isEnabled = !!this.currentPipeline.zenodoPublishStepEnabled;

        toggleEl.checked = isEnabled;
        console.log('Publish Step enabled:', isEnabled);

        if (isEnabled) {
            publishStatusEl.textContent = '✅ Publish Enabled';
            publishStatusEl.className = 'text-green-700 font-semibold';
        } else {
            publishStatusEl.textContent = '⏸️ Publish Disabled';
            publishStatusEl.className = 'text-gray-500 font-semibold';
        }
    }

    addPipelineStep() {
        const stepNumber = this.currentPipeline.steps.length + 1;
        const step = {
            id: `step_${Date.now()}`,
            stepNumber: stepNumber,
            inputs: [],
            component: null,
            outputs: []
        };
        this.currentPipeline.steps.push(step);
        this.renderStep(step);
        this.markAsModified();
    }

    removePipelineStep(stepId) {
        if (!this.currentPipeline || !this.currentPipeline.steps) return;

        // Find and remove the step from the data model
        const stepIndex = this.currentPipeline.steps.findIndex(s => s.id === stepId);
        if (stepIndex > -1) {
            this.currentPipeline.steps.splice(stepIndex, 1);
        }

        // Re-number all subsequent steps
        this.currentPipeline.steps.forEach((step, index) => {
            step.stepNumber = index + 1;
        });

        this.markAsModified();

        // Re-render the entire pipeline UI to reflect the changes and new step numbers
        this.renderBuilderUI();
    }
    
    renderStep(step) {
        const container = document.getElementById('pipelineStepsContainer');
        const stepElement = document.createElement('div');
        stepElement.className = 'pipeline-step';
        stepElement.setAttribute('data-step-number', `Step ${step.stepNumber}`);
        stepElement.setAttribute('data-step-id', step.id);

        // Don't allow removal of the very first step to ensure a starting point
        if (step.stepNumber > 1) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-step-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove this Step';
            removeBtn.addEventListener('click', () => {
                if (confirm(`Are you sure you want to remove Step ${step.stepNumber}?`)) {
                    this.removePipelineStep(step.id);
                }
            });
            stepElement.appendChild(removeBtn);
        }

        const stepContent = document.createElement('div');
        stepContent.className = 'step-content';

        // This prevents an error when loading a pipeline where the source file was removed.
        if (step.stepNumber === 1 && this.currentPipeline.processingMode === 'root' && step.inputs.length > 0) {
            stepContent.appendChild(this.renderFileCard(step.inputs[0], 'input'));
        } else {
            stepContent.appendChild(this.renderInputSelector(step));
        }

        stepContent.appendChild(this.createConnector());

        // Component selector or component card
        if (step.component) {
            stepContent.appendChild(this.renderComponentCard(step.component, step.id));
        } else {
            stepContent.appendChild(this.renderAddComponentButton(step.id));
        }

        // Add connector for outputs
        if (step.component) {
            stepContent.appendChild(this.createConnector());
            
            step.outputs.forEach(output => {
                stepContent.appendChild(this.renderFileCard(output, 'output'));
            });
        }

        stepElement.appendChild(stepContent);
        stepElement.appendChild(this.renderStepFooter(step));
        container.appendChild(stepElement);
    }

    renderStepFooter(step) {
        const footer = document.createElement('div');
        footer.className = 'step-footer';

        const hasOutputs = step.component && step.outputs && step.outputs.length > 0;
        
        if (hasOutputs) {
            const outputMappingBtn = document.createElement('button');
            outputMappingBtn.className = 'show-output-mapping-btn';
            outputMappingBtn.textContent = 'Configure Step Outputs';
            outputMappingBtn.addEventListener('click', () => this.showOutputMappingModal(step.id));
            footer.appendChild(outputMappingBtn);
        } else {
            footer.innerHTML = `<p class="text-xs text-gray-400 text-center">Add a component to configure outputs.</p>`;
        }
        return footer;
    }

    renderFileCard(file, context = 'output') { // Default context to 'output'
        const card = document.createElement('div');
        card.className = `file-card ${file.isSource ? 'source-file' : (context === 'output' ? 'output-file' : 'input-file')}`;
        card.setAttribute('data-file-id', file.id);

        const header = document.createElement('div');
        header.className = 'file-card-header';

        if (file.isSource) {
            // Add remove button for the main Source File
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-source-btn';
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove Source File';
            removeBtn.addEventListener('click', (e) => {
                const card = e.target.closest('.file-card');
                const stepElement = card.closest('.pipeline-step');
                this.removeInputFromStep(stepElement.dataset.stepId, file.id);
                card.remove(); // Also remove the DOM element directly
            });
            card.appendChild(removeBtn);
        } else if (context === 'input') {
            // Add remove button for any other input file
            const removeBtn = document.createElement('button');
            removeBtn.className = 'remove-source-btn'; // Re-use styling
            removeBtn.innerHTML = '&times;';
            removeBtn.title = 'Remove Input';
            removeBtn.addEventListener('click', () => {
                const stepElement = card.closest('.pipeline-step');
                this.removeInputFromStep(stepElement.dataset.stepId, file.id);
            });
            card.appendChild(removeBtn);
        }

        const icon = document.createElement('div');
        const fileType = file.type || 'data';
        icon.className = `file-icon ${fileType}`;
        icon.textContent = fileType.charAt(0).toUpperCase();

        const title = document.createElement('div');
        title.className = 'file-title';
        title.textContent = file.name || 'Unknown File';

        header.appendChild(icon);
        header.appendChild(title);

        const preview = document.createElement('div');
        preview.className = 'file-preview';
        preview.textContent = file.filename || 'unknown.file';
        preview.title = file.filename || 'unknown.file';

        const switches = document.createElement('div');
        switches.className = 'file-switches';

        if (context === 'output') {
            const recordSwitch = this.createFileSwitch(
                'Add to Record',
                'addToRecord',
                file.addToRecord !== false,
                (newValue) => this.updateFileProperty(file.id, 'addToRecord', newValue)
            );
            switches.appendChild(recordSwitch);
        }

        card.appendChild(header);
        card.appendChild(preview);
        card.appendChild(switches);

        return card;
    }

    renderInputSelector(step) {
        const selector = document.createElement('div');
        selector.className = 'input-selector';

        // Show selected inputs first
        if (step.inputs.length > 0) {
            const selectedInputs = document.createElement('div');
            selectedInputs.className = 'selected-inputs mb-3';

            step.inputs.forEach(input => {
                // This renders cards for selected inputs
                const inputCard = this.renderFileCard(input, 'input');
                inputCard.classList.add('input-file-card');
                selectedInputs.appendChild(inputCard);
            });

            selector.appendChild(selectedInputs);
        }

        // Dropdown for adding more inputs
        const dropdown = document.createElement('select');
        dropdown.className = 'input-dropdown';
        dropdown.innerHTML = '<option value="">Select Input...</option>';

        // Get available files from previous steps (excluding already selected ones)
        const availableFiles = this.getAvailableFiles(step.stepNumber);
        const selectedInputNames = step.inputs.map(input => `${input.name}:${input.type}`);
        
        // Filter out already selected files
        const unselectedFiles = availableFiles.filter(file => {
            const fileKey = `${file.name}:${file.type}`;
            return !selectedInputNames.includes(fileKey);
        });
        
        unselectedFiles.forEach(file => {
            const option = document.createElement('option');
            option.value = file.id;
            option.textContent = `${file.name} (${file.type})`;
            dropdown.appendChild(option);
        });

        dropdown.addEventListener('change', (e) => {
            if (e.target.value) {
                this.addInputToStep(step.id, e.target.value);
                e.target.value = ''; // Reset dropdown
            }
        });

        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';
        inputGroup.appendChild(dropdown);
        // inputGroup.appendChild(addBtn);

        selector.appendChild(inputGroup);

        return selector;
    }

    renderAddComponentButton(stepId) {
        const button = document.createElement('button');
        button.className = 'add-component-btn';
        button.textContent = '+';
        button.addEventListener('click', () => {
            this.showComponentSelector(stepId);
        });
        return button;
    }

    renderComponentCard(component, stepId) {
        const cardContainer = document.createElement('div');
        cardContainer.className = 'component-card-wrapper';

        const inputsButton = document.createElement('button');
        inputsButton.className = 'component-inputs-btn';
        inputsButton.innerHTML = '<span>Inputs</span>';
        inputsButton.addEventListener('click', () => {
            this.showInputMappingModal(stepId, component);
        });
        cardContainer.appendChild(inputsButton);

        const card = document.createElement('div');
        card.className = 'component-card-pipeline';

        // Set title, identifier, type...
        card.innerHTML = `<div class="component-title">${component.label || component.name}</div>
                          <div class="component-identifier">${component.name}</div>
                          <div class="component-type">${component.category}</div>`;

        const actions = document.createElement('div');
        actions.className = 'component-actions';

        const infoBtn = document.createElement('button');
        infoBtn.className = 'component-btn';
        infoBtn.textContent = 'Info';
        infoBtn.addEventListener('click', () => {
            // Updated to call the imported function directly
            showInfoModal(component);
        });

        const paramsBtn = document.createElement('button');
        paramsBtn.className = 'component-btn';
        paramsBtn.textContent = 'Parameters';
        paramsBtn.addEventListener('click', () => {
            // Updated to call the imported function directly
            showConfigModal(component, stepId);
        });

        const removeCompBtn = document.createElement('button');
        removeCompBtn.className = 'component-btn remove-component-btn';
        removeCompBtn.title = 'Remove Component';
        removeCompBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>`;
        removeCompBtn.addEventListener('click', () => {
            this.removeComponentFromStep(stepId);
        });

        actions.appendChild(infoBtn);
        actions.appendChild(paramsBtn);
        actions.appendChild(removeCompBtn);
        card.appendChild(actions);
        cardContainer.appendChild(card);

        return cardContainer;
    }

    removeComponentFromStep(stepId) {
        const step = this.findStepById(stepId);
        if (!step) return;

        // Reset the component and its outputs in the data model
        step.component = null;
        step.outputs = [];
        step.stepName = null; // Reset name
        this.markAsModified();

        // Find the step's DOM element and re-render its content
        const stepElement = document.querySelector(`.pipeline-step[data-step-id="${stepId}"]`);
        if (stepElement) {
            const stepContent = stepElement.querySelector('.step-content');
            const stepFooter = stepElement.querySelector('.step-footer');

            // Clear old content
            if (stepContent) stepContent.innerHTML = '';

            // Re-render content which will now show the "+" button
            if (step.stepNumber === 1 && this.currentPipeline.processingMode === 'root' && step.inputs.length > 0) {
                stepContent.appendChild(this.renderFileCard(step.inputs[0]));
            } else {
                stepContent.appendChild(this.renderInputSelector(step));
            }
            stepContent.appendChild(this.createConnector());
            stepContent.appendChild(this.renderAddComponentButton(step.id));

            // Re-render footer which will now show the "add a component" message
            if(stepFooter) {
                const newFooter = this.renderStepFooter(step);
                stepFooter.parentNode.replaceChild(newFooter, stepFooter);
            }
        }
    }
    
    showComponentSelector(stepId) {
        const modal = document.getElementById('componentSelectorModal');
        const list = document.getElementById('componentSelectorList');
        const searchInput = document.getElementById('componentSearchInput');
        
        // 1. Clear previous state
        list.innerHTML = '';
        searchInput.value = '';

        // 2. Populate the component list
        this.availableComponents.forEach(component => {
            const item = document.createElement('div');
            const isInstalled = component.status === 'installed';
            item.className = `component-selector-item ${isInstalled ? 'installed' : 'unavailable'}`;
            
            item.innerHTML = `
                <div class="font-semibold">${component.label || component.name}</div>
                <div class="text-sm text-gray-600">${component.category}</div>
                <div class="text-xs text-gray-500">${component.description || 'No description'}</div>
            `;

            if (isInstalled) {
                item.addEventListener('click', () => {
                    this.addComponentToStep(stepId, component);
                    this.hideComponentSelector();
                });
            }
            list.appendChild(item);
        });

        // 3. Set up event listeners for the search functionality

        // Live filtering as the user types
        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.toLowerCase();
            const items = list.querySelectorAll('.component-selector-item');
            items.forEach(item => {
                const itemText = item.textContent.toLowerCase();
                const isMatch = itemText.includes(searchTerm);
                item.classList.toggle('hidden', !isMatch);
            });
        });

        // Handle "Enter" key press to add the first visible component
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent any form submission
                const firstVisibleItem = list.querySelector('.component-selector-item:not(.hidden)');
                if (firstVisibleItem) {
                    firstVisibleItem.click(); // Simulate a click on the first match
                }
            }
        });

        // 4. Show the modal and auto-focus the search bar
        modal.classList.remove('hidden');
        searchInput.focus();
    }

    hideComponentSelector() {
        document.getElementById('componentSelectorModal').classList.add('hidden');
    }

    addComponentToStep(stepId, component) {
        const step = this.currentPipeline.steps.find(s => s.id === stepId);
        if (!step) {
            console.error("Could not find step to add component to:", stepId);
            return;
        }

        // 1. Update the data model for the step
        step.component = {
            name: component.name,
            label: component.label || component.name,
            category: component.category,
            version: component.version || '1.0.0',
            instanceId: `${component.name}_${stepId}_${Date.now()}`,
            parameters: {} // Initialize with empty parameters
        };
        step.stepName = component.label || component.name;
        step.outputs = this.generateOutputFiles(component);
        this.markAsModified();

        // 2. Find the step's main DOM element
        const stepElement = document.querySelector(`div.pipeline-step[data-step-id="${stepId}"]`);
        if (!stepElement) {
            console.error("Could not find step DOM element to update:", stepId);
            return;
        }

        // 3. Re-render the step's internal content completely
        const stepContent = stepElement.querySelector('.step-content');
        if (stepContent) {
            // Clear the old content
            stepContent.innerHTML = '';
            
            // This prevents the error when the source file has been removed.
            if (step.stepNumber === 1 && this.currentPipeline.processingMode === 'root' && step.inputs.length > 0) {
                stepContent.appendChild(this.renderFileCard(step.inputs[0]));
            } else {
                stepContent.appendChild(this.renderInputSelector(step));
            }

            stepContent.appendChild(this.createConnector());
            stepContent.appendChild(this.renderComponentCard(step.component, step.id));
            stepContent.appendChild(this.createConnector());
            
            step.outputs.forEach(output => {
                stepContent.appendChild(this.renderFileCard(output));
            });
        }
        
        // 4. Re-render the footer specifically
        const stepFooter = stepElement.querySelector('.step-footer');
        if (stepFooter) {
            const newFooter = this.renderStepFooter(step);
            stepFooter.parentNode.replaceChild(newFooter, stepFooter);
        }
        
        console.log('Updated step with new component:', step);
    }

    getAvailableFiles(forStepNumber) {
        const files = [];
        const seenFileIds = new Set();

        const addFile = (file, context) => {
            if (file && file.id && !seenFileIds.has(file.id)) {
                seenFileIds.add(file.id);
                files.push({ ...file, ...context });
            }
        };

        if (this.currentPipeline.processingMode === 'root' && this.currentPipeline.steps[0]?.inputs[0]) {
            const sourceFile = this.currentPipeline.steps[0].inputs[0];
            addFile(sourceFile, {
                sourceComponentLabel: 'Pipeline Source',
                sourceStepNumber: 0 // Use 0 to signify it's the global source
            });
        }

        // 1. Add INPUTS from the CURRENT step.
        const currentStep = this.currentPipeline.steps[forStepNumber - 1];
        if (currentStep && currentStep.inputs) {
            currentStep.inputs.forEach(input => addFile(input, {
                sourceComponentLabel: 'This Step',
                sourceStepNumber: currentStep.stepNumber
            }));
        }

        // 2. Add OUTPUTS from all PREVIOUS steps.
        for (let i = 0; i < forStepNumber - 1; i++) {
            const prevStep = this.currentPipeline.steps[i];
            if (prevStep && prevStep.outputs) {
                prevStep.outputs.forEach(output => addFile(output, {
                    sourceComponentLabel: prevStep.component?.label || 'Previous Step',
                    sourceStepNumber: prevStep.stepNumber
                }));
            }
        }
        
        return files;
    }

    addInputToStep(stepId, fileId) {
        const step = this.findStepById(stepId);
        const file = this.findFileById(fileId);
        
        if (step && file) {
            // Add the file to the step's inputs if it's not already there
            const existingInput = step.inputs.find(input => input.id === fileId);
            if (!existingInput) {
                step.inputs.push(file);
                this.markAsModified();
            }
            
            // Re-render the input selector area to show the new card
            this.updateInputSelector(stepId);
        } else {
            console.error(`Could not add input. Step or File not found. StepID: ${stepId}, FileID: ${fileId}`);
        }
    }
    
    updateInputSelector(stepId) {
        const stepElement = document.querySelector(`div.pipeline-step[data-step-id="${stepId}"]`);
        if (!stepElement) return;
        
        const inputSelector = stepElement.querySelector('.input-selector');
        
        if (inputSelector) {
            const step = this.currentPipeline.steps.find(s => s.id === stepId);
            if (step) {
                const newInputSelector = this.renderInputSelector(step);
                if (inputSelector.parentNode) {
                    inputSelector.parentNode.replaceChild(newInputSelector, inputSelector);
                }
            }
        }
    }

    findFileById(fileId) {
        for (const step of this.currentPipeline.steps) {
            for (const input of step.inputs) {
                if (input.id == fileId) return input;
            }
            for (const output of step.outputs) {
                if (output.id == fileId) return output;
            }
        }
        return null;
    }

    markAsModified() {
        if (this.currentPipeline) {
            this.currentPipeline.lastModified = new Date().toISOString();
            this.currentPipeline.isModified = true;
            
            // Update UI to show modified state
            const pipelineName = document.getElementById('currentPipelineName');
            if (pipelineName && !pipelineName.textContent.endsWith(' *')) {
                pipelineName.textContent += ' *';
            }
        }
    }

    clearModifiedState() {
        if (!this.currentPipeline) return;
        
        this.currentPipeline.isModified = false;
        
        const pipelineName = document.getElementById('currentPipelineName');
        if (pipelineName) {
            pipelineName.textContent = pipelineName.textContent.replace(' *', '');
        }
    }

    setupConfigSaveHandler(component, stepId) {
        const saveBtn = document.getElementById('saveComponentOptionsBtn');
        if (!saveBtn) return;
        
        // Clone button to remove existing listeners, ensuring a clean state
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

        newSaveBtn.addEventListener('click', async () => {
            try {
                const updatedParams = {};
                const paramInputs = optionsModalBody.querySelectorAll('.parameter-control');

                // This new collection logic is robust and works with the form
                // generated by the modern `buildParameterInput` method.
                paramInputs.forEach(input => {
                    const container = input.closest('[data-param-name]');
                    if (!container) return;

                    const paramName = container.dataset.paramName;
                    let value;

                    if (input.type === 'checkbox') {
                        value = input.checked;
                    } else if (input.type === 'number') {
                        value = input.value === '' ? null : parseFloat(input.value);
                    } else {
                        value = input.value;
                    }
                    
                    // Only include non-null values to avoid saving empty strings
                    if (value !== null) {
                        updatedParams[paramName] = value;
                    }
                });
                
                // Because this is now a class method, we can safely use 'this'.
                if (this.currentPipeline && stepId) {
                    const step = this.findStepById(stepId);
                    
                    if (step && step.component) {
                        // Overwrite the parameters for this specific step
                        step.component.parameters = { ...updatedParams };
                        
                        // Use the class method to mark the pipeline as modified
                        this.markAsModified();
                        
                        showToast('Parameters saved to pipeline successfully!', 'success');
                    } else {
                        console.error('❌ Could not find step or component for parameter update:', { stepId });
                        showToast('Error: Could not find step in pipeline.', 'error');
                    }
                } else {
                    console.error('❌ Pipeline constructor or current pipeline not available.');
                    showToast('Error: No active pipeline context.', 'error');
                }
                
                // The fallback API call to save to the component system remains a good safety net.
                try {
                    await fetch(`${COMPONENT_API_BASE}/${component.name}/config`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ parameters: updatedParams })
                    });
                } catch (componentSaveError) {
                    console.warn('Could not save config to component system (fallback):', componentSaveError);
                }

                optionsModal.classList.add('hidden');

            } catch (error) {
                console.error('Error saving configuration:', error);
                showToast(`Error: ${error.message}`, 'error');
            }
        });
    }

    async savePipeline() {
        if (!this.currentPipeline) {
            showToast('No pipeline to save', 'error');
            return;
        }

        this.markAsModified();

        // No special data copying is needed here. The `outputMapping` property
        // on each output file will be serialized correctly.
        const pipelineToSave = this.currentPipeline;

        try {
            const existingPipeline = this.pipelines.find(p => p.identifier === pipelineToSave.identifier);

            let response;
            let successMessage;

            if (existingPipeline) {
                response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines/${pipelineToSave.identifier}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pipelineToSave)
                });
                successMessage = 'Pipeline updated successfully!';
            } else {
                response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(pipelineToSave)
                });
                successMessage = 'Pipeline created successfully!';
            }

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to save pipeline');
            }

            const result = await response.json();

            if (result.success) {
                const pipelineIndex = this.pipelines.findIndex(p => p.identifier === this.currentPipeline.identifier);
                if (pipelineIndex >= 0) {
                    this.pipelines[pipelineIndex] = { ...this.currentPipeline };
                } else {
                    this.pipelines.push({ ...this.currentPipeline });
                }

                this.updatePipelineSelector();
                this.clearModifiedState();
                showToast(successMessage, 'success');
            } else {
                throw new Error(result.error || 'Save operation failed');
            }

        } catch (error) {
            console.error('Error saving pipeline:', error);
            showToast(`Failed to save pipeline: ${error.message}`, 'error');
        }
    }

    async exportPipelineYAML() {
        if (!this.currentPipeline) {
            showToast('No pipeline to export', 'error');
            return;
        }

        // Validate pipeline
        const issues = this.validatePipelineBeforeExport();
        if (issues.length > 0) {
            const continueExport = confirm(
                `The following issues were found in your pipeline:\n\n${issues.join('\n')}\n\nDo you want to export anyway?`
            );
            if (!continueExport) return;
        }

        try {
            const yamlContent = this.generatePipelineYAML(this.currentPipeline);
            
            const blob = new Blob([yamlContent], { type: 'text/yaml' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${this.currentPipeline.identifier}.yaml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showToast('Pipeline exported successfully!', 'success');
            
        } catch (error) {
            console.error('Error exporting pipeline:', error);
            showToast('Failed to export pipeline', 'error');
        }
    }

    async loadExistingPipelines() {
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines`);
            const pipelines = await response.json();
            
            this.pipelines = pipelines;
            this.updatePipelineSelector();
        } catch (error) {
            console.error('Error loading pipelines:', error);
        }
    }

    updatePipelineSelector() {
        const select = document.getElementById('existingPipelineMainSelect');
        select.innerHTML = '<option value="">Select a pipeline...</option>';
        
        this.pipelines.forEach(pipeline => {
            const option = document.createElement('option');
            option.value = pipeline.identifier;
            option.textContent = `${pipeline.name} (${pipeline.modality})`;
            select.appendChild(option);
        });
    }

    async loadPipeline(identifier) {
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines/${identifier}`);
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Failed to load pipeline.' }));
                throw new Error(errorData.error);
            }
            const pipeline = await response.json();

            this.currentPipeline = await this.transformDatabasePipeline(pipeline);

            if (this.currentPipeline.zenodoDraftStepEnabled === undefined) {
                this.currentPipeline.zenodoDraftStepEnabled = true; // Default for older pipelines
            }

            this._recalculateFileCounters(this.currentPipeline);

            this.renderBuilderUI();
            this.updateFinalStepStatus();

        } catch (error) {
            console.error('Error loading pipeline:', error);
            showToast(`Failed to load pipeline: ${error.message}`, 'error');
        }
    }

    async importPipelineYAML() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.yaml,.yml';
        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    const formData = new FormData();
                    formData.append('file', file);
                    
                    const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipelines/import`, {
                        method: 'POST',
                        body: formData
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        showToast('Pipeline imported successfully!', 'success');
                        this.loadExistingPipelines();
                    } else {
                        throw new Error(result.error || 'Import failed');
                    }
                } catch (error) {
                    console.error('Error importing pipeline:', error);
                    showToast('Failed to import pipeline', 'error');
                }
            }
        });
        input.click();
    }
    
    // --- All Modal and UI Helper Methods for the Constructor ---
    
    async showInputMappingModal(stepId, component) {
        const modal = document.getElementById('inputMappingModal');
        const modalTitle = document.getElementById('inputMappingModalTitle');
        const modalBody = document.getElementById('inputMappingModalBody');
        
        modalTitle.textContent = `Input Mapping for: ${component.label || component.name}`;
        modalBody.innerHTML = '<p class="p-4 text-center">Loading component details...</p>';
        modal.classList.remove('hidden');

        try {
            // Find the current step data
            const step = this.findStepById(stepId);
            if (!step) throw new Error("Step not found in current pipeline.");

            // Fetch the component's full definition
            const response = await fetch(`${COMPONENT_API_BASE}/${component.name}/config`);
            if (!response.ok) throw new Error("Could not fetch component configuration.");
            const componentConfig = await response.json();
            const componentInputs = componentConfig.inputs || [];

            // The call now correctly gets files ONLY from steps before the current one.
            const availableFiles = this.getAvailableFiles(step.stepNumber);

            // Render the main modal structure
            modalBody.innerHTML = `
                <div class="input-mapping-grid">
                    <div id="mappingSourcePanel" class="mapping-panel">
                        </div>
                    <div id="mappingDestinationPanel" class="mapping-panel">
                        </div>
                </div>
            `;

            this.renderMappingSourcePanel(step, availableFiles);
            this.renderMappingDestinationPanel(componentInputs, step.inputMapping || {});

            // Setup Save/Cancel buttons
            document.getElementById('saveInputMappingBtn').onclick = () => this.saveInputMapping(stepId);
            document.getElementById('cancelInputMappingBtn').onclick = () => this.hideInputMappingModal();
            document.getElementById('closeInputMappingModal').onclick = () => this.hideInputMappingModal();

        } catch (error) {
            console.error("Error setting up input mapping modal:", error);
            modalBody.innerHTML = `<p class="p-4 text-red-500 text-center">Error: ${error.message}</p>`;
        }
    }

    hideInputMappingModal() {
        document.getElementById('inputMappingModal').classList.add('hidden');
    }

    renderMappingSourcePanel(step, availableFiles) {
        const panel = document.getElementById('mappingSourcePanel');
        panel.innerHTML = `
            <h3 class="panel-title">Data Source</h3>
            <div class="source-section">
                <h4>Pipeline Files</h4>
                <div id="pipelineFileSources" class="max-h-48 overflow-y-auto"></div>
            </div>
            <div class="source-section">
                <h4>External File Path</h4>
                <div class="input-group-button">
                    <input type="text" id="externalPathSource" placeholder="Enter absolute path...">
                    <button id="browseExternalPathBtn" class="btn-secondary">Browse...</button>
                </div>
            </div>
            <div class="source-section">
                <h4>Literal Value</h4>
                <input type="text" id="literalValueSource" placeholder="Enter a fixed string or number...">
            </div>
        `;

        // Populate pipeline file sources with informative names
        const fileSourcesContainer = panel.querySelector('#pipelineFileSources');
        if (availableFiles.length > 0) {
            availableFiles.forEach(file => {
                const fileEl = document.createElement('div');
                fileEl.className = 'source-item';
                // Construct the new, more informative label
                fileEl.textContent = `${file.name} (${file.sourceComponentLabel} | Step ${file.sourceStepNumber})`;
                fileEl.title = `Original filename: ${file.filename}`;
                fileEl.dataset.sourceType = 'pipelineFile';
                fileEl.dataset.fileId = file.id;
                fileEl.dataset.sourceStepNumber = file.sourceStepNumber;
                fileEl.dataset.sourceComponentLabel = file.sourceComponentLabel;
                fileSourcesContainer.appendChild(fileEl);
            });
        } else {
            fileSourcesContainer.innerHTML = `<p class="text-xs text-gray-500 p-2">No files available from previous steps.</p>`;
        }

        panel.querySelector('#browseExternalPathBtn').addEventListener('click', async () => {
            const path = await window.electronAPI.openFile({});
            if(path) {
                const externalPathInput = panel.querySelector('#externalPathSource');
                externalPathInput.value = path;
                externalPathInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    renderMappingDestinationPanel(componentInputs, existingMapping) {
        const panel = document.getElementById('mappingDestinationPanel');
        panel.innerHTML = '<h3 class="panel-title">Component Inputs</h3>';

        if(componentInputs.length === 0) {
            panel.innerHTML += '<p class="text-gray-500 p-4">This component requires no inputs.</p>';
            return;
        }

        componentInputs.forEach(input => {
            const inputEl = document.createElement('div');
            inputEl.className = 'destination-item';
            inputEl.dataset.inputName = input.name;

            const currentMap = existingMapping[input.name];
            let mappedValueDisplay = 'Not Mapped';
            if (currentMap) {
                switch(currentMap.sourceType) {
                    case 'pipelineFile': mappedValueDisplay = `Pipeline File (ID: ${currentMap.fileId})`; break;
                    case 'externalPath': mappedValueDisplay = `External: ${currentMap.path}`; break;
                    case 'literal': mappedValueDisplay = `Literal: "${currentMap.value}"`; break;
                    case 'derivedLiteral': mappedValueDisplay = `Derived from ${currentMap.fileId}`; break;
                }
            }

            inputEl.innerHTML = `
                <div class="dest-info">
                    <strong>${input.label || input.name}</strong>
                    <span class="text-xs text-gray-500">${input.data_type_tag} ${input.required ? '<span class="text-red-500">*</span>' : ''}</span>
                    <p class="text-sm">${input.description}</p>
                </div>
                <div class="dest-mapping-status" data-mapped-value="${mappedValueDisplay}">
                    ${mappedValueDisplay}
                </div>
                <button class="map-btn">Map</button>
            `;
            panel.appendChild(inputEl);
        });

        this.addMappingEventListeners();
    }
    
    addMappingEventListeners() {
        const sourcePanel = document.getElementById('mappingSourcePanel');
        const destPanel = document.getElementById('mappingDestinationPanel');
        if (!sourcePanel || !destPanel) return;

        const handleSourceSelection = (activeType) => {
            this._clearOtherSources(activeType);
            this.updateSourcePanelInteractivity();
        };

        // Pipeline Files Selection
        sourcePanel.addEventListener('click', (e) => {
            const sourceItem = e.target.closest('.source-item');
            if (sourceItem) {
                if (sourceItem.classList.contains('active')) {
                    sourceItem.classList.remove('active');
                } else {
                    handleSourceSelection('pipelineFile');
                    sourceItem.classList.add('active');
                }
                this.updateSourcePanelInteractivity();
            }
        });

        // External File Path Input
        const externalPathInput = sourcePanel.querySelector('#externalPathSource');
        if (externalPathInput) {
            externalPathInput.addEventListener('input', () => {
                if (externalPathInput.value.trim() !== '') {
                    handleSourceSelection('externalPath');
                }
                this.updateSourcePanelInteractivity();
            });
        }

        // Literal Value Input
        const literalValueInput = sourcePanel.querySelector('#literalValueSource');
        if (literalValueInput) {
            literalValueInput.addEventListener('input', () => {
                if (literalValueInput.value.trim() !== '') {
                    handleSourceSelection('literal');
                }
                this.updateSourcePanelInteractivity();
            });
        }

        // "Map" Button Click
        destPanel.addEventListener('click', (e) => {
            const mapButton = e.target.closest('.map-btn');
            if (mapButton) {
                const destItem = mapButton.closest('.destination-item');
                const activeSource = sourcePanel.querySelector('.source-item.active');

                let mappingConfig = null;
                let mappedValueDisplay = 'Error: No source selected';

                const externalPath = sourcePanel.querySelector('#externalPathSource').value.trim();
                const literalValue = sourcePanel.querySelector('#literalValueSource').value.trim();

                if (activeSource) {
                    const fileId = activeSource.dataset.fileId;
                    const fileName = this.findFileById(fileId)?.name || 'Unknown File'; // Get name safely
                    const sourceStep = activeSource.dataset.sourceStepNumber;
                    const sourceLabel = activeSource.dataset.sourceComponentLabel;

                    mappingConfig = { sourceType: 'pipelineFile', fileId: fileId };
                    mappedValueDisplay = `Pipeline File: ${fileName} (${sourceLabel} | Step ${sourceStep})`;
                } else if (externalPath) {
                    mappingConfig = { sourceType: 'externalPath', path: externalPath };
                    mappedValueDisplay = `External: ${externalPath}`;
                } else if (literalValue) {
                    mappingConfig = { sourceType: 'literal', value: literalValue };
                    mappedValueDisplay = `Literal: "${literalValue}"`;
                }

                if (mappingConfig) {
                    destItem.querySelector('.dest-mapping-status').textContent = mappedValueDisplay;
                    destItem.dataset.mapping = JSON.stringify(mappingConfig);
                    destItem.classList.add('mapped');

                    this._clearAllSources();
                    this.updateSourcePanelInteractivity();

                } else {
                    alert('Please select or define a data source from the left panel before mapping.');
                }
            }
        });

        // Initial state update
        this.updateSourcePanelInteractivity();
    }

    _clearOtherSources(activeSourceType) {
        const sourcePanel = document.getElementById('mappingSourcePanel');
        if (!sourcePanel) return;

        // Clear Pipeline File selection
        if (activeSourceType !== 'pipelineFile') {
            sourcePanel.querySelectorAll('.source-item.active').forEach(el => el.classList.remove('active'));
        }

        // Clear External Path
        if (activeSourceType !== 'externalPath') {
            const externalPathInput = sourcePanel.querySelector('#externalPathSource');
            if (externalPathInput) externalPathInput.value = '';
        }

        // Clear Literal Value
        if (activeSourceType !== 'literal') {
            const literalValueInput = sourcePanel.querySelector('#literalValueSource');
            if (literalValueInput) literalValueInput.value = '';
        }
    }

    _clearAllSources() {
        const sourcePanel = document.getElementById('mappingSourcePanel');
        if (!sourcePanel) return;

        // Clear Pipeline File selection
        sourcePanel.querySelectorAll('.source-item.active').forEach(el => el.classList.remove('active'));

        // Clear other input fields
        const externalPathInput = sourcePanel.querySelector('#externalPathSource');
        if (externalPathInput) externalPathInput.value = '';

        const literalValueInput = sourcePanel.querySelector('#literalValueSource');
        if (literalValueInput) literalValueInput.value = '';

        const derivedFileSelect = sourcePanel.querySelector('#derivedFileSource');
        if(derivedFileSelect) derivedFileSelect.value = '';

        const derivedPatternInput = sourcePanel.querySelector('#derivedPattern');
        if(derivedPatternInput) derivedPatternInput.value = '';
    }
    
    updateSourcePanelInteractivity() {
        const sourcePanel = document.getElementById('mappingSourcePanel');
        if (!sourcePanel) return;

        // Helper to safely find a section
        const getSection = (selector) => {
            const el = sourcePanel.querySelector(selector);
            return el ? el.closest('.source-section') : null;
        };

        // Get references to all source sections/containers safely
        const pipelineFilesSection = getSection('#pipelineFileSources');
        const externalPathSection = getSection('#externalPathSource');
        const literalValueSection = getSection('#literalValueSource');

        // Determine which source type is currently active
        let activeSource = null;
        if (sourcePanel.querySelector('.source-item.active')) {
            activeSource = 'pipelineFile';
        } else if (sourcePanel.querySelector('#externalPathSource')?.value.trim() !== '') {
            activeSource = 'externalPath';
        } else if (sourcePanel.querySelector('#literalValueSource')?.value.trim() !== '') {
            activeSource = 'literal';
        }

        // Enable or disable sections based on the active source, checking for existence first
        if (pipelineFilesSection) {
            pipelineFilesSection.classList.toggle('disabled', activeSource && activeSource !== 'pipelineFile');
        }
        if (externalPathSection) {
            externalPathSection.classList.toggle('disabled', activeSource && activeSource !== 'externalPath');
        }
        if (literalValueSection) {
            literalValueSection.classList.toggle('disabled', activeSource && activeSource !== 'literal');
        }
    }

    saveInputMapping(stepId) {
        const step = this.currentPipeline.steps.find(s => s.id === stepId);
        if (!step) {
            showToast("Error: Could not find step to save mapping.", "error");
            return;
        }

        const newMapping = {};
        document.querySelectorAll('#mappingDestinationPanel .destination-item').forEach(destItem => {
            const inputName = destItem.dataset.inputName;
            const mappingJson = destItem.dataset.mapping;
            if (mappingJson) {
                newMapping[inputName] = JSON.parse(mappingJson);
            }
        });

        step.inputMapping = newMapping;
        this.markAsModified();
        this.hideInputMappingModal();
        showToast("Input mapping saved to current pipeline.", "success");
    }

    showOutputMappingModal(stepId) {
        const modal = document.getElementById('outputMappingModal');
        const modalBody = document.getElementById('outputMappingModalBody');
        if (!modal || !modalBody || !this.currentPipeline) return;

        const step = this.findStepById(stepId);
        if (!step) {
            showToast("Error: Could not find the pipeline step.", "error");
            return;
        }
        const outputsForStep = step.outputs || [];

        modalBody.innerHTML = `
            <div class="output-mapping-grid">
                <div class="output-list-panel">
                    <h3 class="panel-title p-4">Step ${step.stepNumber} Outputs</h3>
                    <div id="outputListContainer"></div>
                </div>
                <div id="outputOptionsPanel" class="output-options-panel">
                    <div class="flex items-center justify-center h-full">
                        <p class="text-center text-gray-500 p-8">Select an output to configure.</p>
                    </div>
                </div>
            </div>`;

        this.renderOutputList(outputsForStep);

        // --- Note: The Save button simply closes the modal. ---
        // All changes are already saved "live" to the in-memory pipeline object.
        document.getElementById('saveOutputMappingBtn').onclick = () => this.hideOutputMappingModal();
        document.getElementById('closeOutputMappingModal').onclick = () => this.hideOutputMappingModal();
        document.getElementById('closeOutputMappingBtn').onclick = () => this.hideOutputMappingModal();

        modal.classList.remove('hidden');

        const firstItem = document.querySelector('.output-list-item');
        if (firstItem) {
            firstItem.click();
        }
    }

    hideOutputMappingModal() {
        document.getElementById('outputMappingModal').classList.add('hidden');
    }
    
    renderOutputList(outputs) {
        const container = document.getElementById('outputListContainer');
        container.innerHTML = '<h3 class="panel-title p-4">Pipeline Outputs</h3>';
        if (outputs.length === 0) {
            container.innerHTML += '<p class="p-4 text-sm text-gray-500">No outputs defined.</p>';
            return;
        }

        outputs.forEach(output => {
            const item = document.createElement('div');
            item.className = 'output-list-item';
            item.dataset.fileId = output.id;
            item.innerHTML = `<div class="output-item-name">${output.name}</div><div class="output-item-sub">${output.filename}</div>`;
            
            item.addEventListener('click', () => {
                container.querySelectorAll('.output-list-item.active').forEach(el => el.classList.remove('active'));
                item.classList.add('active');
                this.renderOutputMappingOptions(output.id);
            });
            container.appendChild(item);
        });
    }

    renderOutputMappingOptions(fileId) {
        const panel = document.getElementById('outputOptionsPanel');
        const outputFile = this.findFileById(fileId);
        if (!outputFile) return;

        // Ensure outputMapping object exists
        outputFile.outputMapping = outputFile.outputMapping || { mapToZenodo: false, zenodoMappings: [] };
        const isInitiallyMapped = outputFile.outputMapping.mapToZenodo === true;

        panel.innerHTML = `
            <h3 class="panel-title">${outputFile.name}</h3>
            <div id="options-content" class="p-4 space-y-4">
                <div class="options-section">
                    <h4 class="options-section-title">General Actions</h4>
                    <div id="generalOptionsContainer" class="space-y-2"></div>
                </div>
                <div class="options-section border-t pt-4">
                    <h4 class="options-section-title">Zenodo Metadata</h4>
                    <div id="zenodoSwitchContainer"></div>
                    <div id="zenodoMappingContainer" class="mt-2 ${isInitiallyMapped ? '' : 'hidden'}"></div>
                </div>
            </div>`;

        const generalContainer = panel.querySelector('#generalOptionsContainer');
        const zenodoSwitchContainer = panel.querySelector('#zenodoSwitchContainer');
        const canMapToZenodo = outputFile.type === 'data';

        // --- General Action Switches ---
        generalContainer.appendChild(this.createBinarySwitch(
            "Add to Record", outputFile.addToRecord !== false, "addToRecord",
            (newValue) => this.updateFileProperty(fileId, 'addToRecord', newValue)
        ));
        generalContainer.appendChild(this.createBinarySwitch(
            "Replace Source File", !!outputFile.replaceSourceFile, "replaceSourceFile",
            (newValue) => this.updateFileProperty(fileId, 'replaceSourceFile', newValue)
        ));

        // --- Zenodo Switch with Full Logic ---
        const zenodoSwitchHandler = (newValue) => {
            // 1. Update the data model directly
            outputFile.outputMapping.mapToZenodo = newValue;
            
            // 2. Mark the pipeline as modified (CRITICAL)
            this.markAsModified();
            
            // 3. Update the UI visibility
            const mappingContainer = panel.querySelector('#zenodoMappingContainer');
            if (mappingContainer) {
                mappingContainer.classList.toggle('hidden', !newValue);
                // 4. Render the mapping UI if toggled on (CRITICAL)
                if (newValue && mappingContainer.innerHTML.trim() === '') {
                    this.renderZenodoMappingUI(outputFile, mappingContainer);
                }
            }
        };

        const zenodoSwitch = this.createBinarySwitch('Map Output to Zenodo Metadata', isInitiallyMapped, "mapToZenodo", zenodoSwitchHandler);
        
        // Disable if not applicable
        if (!canMapToZenodo) {
            const input = zenodoSwitch.querySelector('input');
            if (input) input.disabled = true;
            zenodoSwitch.title = "Only outputs of type 'data' can be mapped to Zenodo metadata.";
            zenodoSwitch.classList.add('disabled');
        }

        zenodoSwitchContainer.appendChild(zenodoSwitch);
        
        // Initial render if already mapped
        if (canMapToZenodo && isInitiallyMapped) {
            this.renderZenodoMappingUI(outputFile, panel.querySelector('#zenodoMappingContainer'));
        }
    }

    async renderZenodoMappingUI(outputFile, container) {
        if (!window.zenodoMappingSchema) {
            try {
                const response = await fetch(`${PYTHON_API_BASE_URL}/api/metadata/mapping_schema_details`);
                if (!response.ok) throw new Error("Could not load metadata schema");
                window.zenodoMappingSchema = await response.json();
            } catch (error) {
                container.innerHTML = `<p class="text-red-500">Error: ${error.message}</p>`;
                return;
            }
        }

        container.innerHTML = `
            <div id="zenodo-rules-container" class="space-y-3"></div>
            <button id="add-zenodo-rule-btn" class="btn-secondary mt-4 text-xs">+ Add Mapping Rule</button>
        `;
        this.redrawZenodoRules(outputFile); // Initial drawing of existing rules

        container.querySelector('#add-zenodo-rule-btn').addEventListener('click', () => {
            const rules = outputFile.outputMapping.zenodoMappings;
            const newRuleIndex = rules.length;
            rules.push({ zenodoField: 'title', jsonKey: '', action: 'insert' });

            const rulesContainer = document.getElementById('zenodo-rules-container');
            const ruleDiv = document.createElement('div');
            ruleDiv.className = 'zenodo-mapping-rule';
            // Set innerHTML for the new rule specifically
            ruleDiv.innerHTML = this.getZenodoRuleMarkup(rules[newRuleIndex], newRuleIndex);
            rulesContainer.appendChild(ruleDiv);

            // Attach listeners to the newly created rule's elements
            this.attachSingleRuleListeners(outputFile, ruleDiv, newRuleIndex);
        });
    }

    redrawSingleRule(outputFile, ruleDiv, index) {
        const newMarkup = this.getZenodoRuleMarkup(outputFile.outputMapping.zenodoMappings[index], index);
        ruleDiv.innerHTML = newMarkup;
        this.attachSingleRuleListeners(outputFile, ruleDiv, index);
    }

    redrawZenodoRules(outputFile) {
        const rulesContainer = document.getElementById('zenodo-rules-container');
        if (!rulesContainer) return;

        const zenodoMappings = outputFile.outputMapping.zenodoMappings || [];
        rulesContainer.innerHTML = ''; // Clear existing rules

        zenodoMappings.forEach((rule, index) => {
            const ruleDiv = document.createElement('div');
            ruleDiv.className = 'zenodo-mapping-rule';
            ruleDiv.innerHTML = this.getZenodoRuleMarkup(rule, index);
            rulesContainer.appendChild(ruleDiv);
            this.attachSingleRuleListeners(outputFile, ruleDiv, index);
        });
    }

    attachSingleRuleListeners(outputFile, ruleDiv, index) {
        const removeBtn = ruleDiv.querySelector('.remove-mapping-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                outputFile.outputMapping.zenodoMappings.splice(index, 1);
                this.markAsModified();
                // Just remove the element from the DOM. No full redraw needed.
                ruleDiv.remove(); 
            });
        }
    
        // Add live-update listeners for rule inputs
        ruleDiv.querySelectorAll('[data-field]').forEach(input => {
            input.addEventListener('input', (e) => { // 'input' for text fields
                outputFile.outputMapping.zenodoMappings[index][e.target.dataset.field] = e.target.value;
                this.markAsModified();
            });
            input.addEventListener('change', (e) => { // 'change' for selects and radios
                const field = e.target.dataset.field;
                const value = e.target.type === 'radio' ? e.target.value : e.target.value;
                outputFile.outputMapping.zenodoMappings[index][field] = value;
                this.markAsModified();
    
                // If the zenodoField was changed, redraw this single rule
                if (field === 'zenodoField') {
                    this.redrawSingleRule(outputFile, ruleDiv, index);
                }
            });
        });
    }

    getZenodoRuleMarkup(rule, index) {
        const allowedFields = new Set(["title", "description", "publication_type", "license", "locations", "dates", "subjects", "contributors", "related_identifiers", "grants", "keywords"]);
        const arrayFields = new Set(["locations", "dates", "subjects", "contributors", "related_identifiers", "grants", "keywords"]);
        
        const schemaFields = (window.zenodoMappingSchema?.standard_fields || []).concat(
            Object.keys(window.zenodoMappingSchema?.complex_fields || {}).map(k => ({key: k, label: window.zenodoMappingSchema.complex_fields[k].label}))
        );

        const fieldOptions = schemaFields
            .filter(field => allowedFields.has(field.key))
            .map(field => `<option value="${field.key}" ${rule.zenodoField === field.key ? 'selected' : ''}>${field.label || field.key}</option>`)
            .join('');
        
        let actionRadios = '';
        if (arrayFields.has(rule.zenodoField)) {
            actionRadios = `
                <div class="form-group">
                    <label class="font-bold">Mapping Action</label>
                    <div class="flex gap-4 text-xs mt-1">
                        <label class="flex items-center"><input type="radio" name="action_${index}" value="insert" data-field="action" ${rule.action !== 'replace' ? 'checked' : ''} class="mr-1"> Insert into array</label>
                        <label class="flex items-center"><input type="radio" name="action_${index}" value="replace" data-field="action" ${rule.action === 'replace' ? 'checked' : ''} class="mr-1"> Replace entire field</label>
                    </div>
                </div>
            `;
        }

        return `
            <div data-index="${index}">
                <div class="form-group">
                    <label>Zenodo Field</label>
                    <select data-field="zenodoField">${fieldOptions}</select>
                </div>
                <div class="form-group">
                    <label>JSON Key Path (e.g., data.key)</label>
                    <input type="text" data-field="jsonKey" value="${rule.jsonKey || ''}" placeholder="spatial_coverage.coordinates">
                </div>
                ${actionRadios}
            </div>
            <button class="remove-mapping-btn" title="Remove Rule">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
            </button>
        `;
    }

    createFileSwitch(label, property, checked, changeHandler) {
        const switchDiv = document.createElement('div');
        switchDiv.className = 'file-switch';
        switchDiv.dataset.property = property;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = checked;
        checkbox.addEventListener('change', (e) => {
            if (changeHandler) {
                changeHandler(e.target.checked);
            }
        });

        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.className = 'cursor-pointer select-none';
        
        labelEl.addEventListener('click', () => {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
        });

        switchDiv.appendChild(checkbox);
        switchDiv.appendChild(labelEl);

        return switchDiv;
    }

    addInitialStep() {
        const step = {
            id: `step_${Date.now()}`,
            stepNumber: 1,
            inputs: [],
            component: null,
            outputs: []
        };

        if (this.currentPipeline.processingMode === 'root') {
            step.inputs.push(this.createSourceFile());
        }

        this.currentPipeline.steps.push(step);
        this.renderStep(step);
    }
    
    removeInputFromStep(stepId, fileId) {
        const step = this.findStepById(stepId);
        if (!step) return;

        step.inputs = step.inputs.filter(input => input.id != fileId);
        this.markAsModified();
        this.updateInputSelector(stepId);
    }

    createConnector() {
        const connector = document.createElement('div');
        connector.className = 'connector';
        return connector;
    }

    createBinarySwitch(labelText, isChecked, propertyName, changeHandler) {
        const wrapper = document.createElement('div');
        wrapper.className = 'binary-switch';
        if (propertyName) {
            wrapper.dataset.prop = propertyName;
        }

        const label = document.createElement('span');
        label.className = 'binary-switch-label';
        label.textContent = labelText;
        
        const switchLabel = document.createElement('label');
        switchLabel.className = 'switch';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isChecked;
        checkbox.addEventListener('change', (e) => {
            if (changeHandler) {
                changeHandler(e.target.checked);
            }
        });

        const slider = document.createElement('span');
        slider.className = 'slider';

        switchLabel.appendChild(checkbox);
        switchLabel.appendChild(slider);
        wrapper.appendChild(label);
        wrapper.appendChild(switchLabel);

        return wrapper;
    }

    rerenderStep(step) {
        const stepElement = document.querySelector(`[data-step-id="${step.id}"]`);
        if (stepElement) {
            const container = stepElement.parentNode;
            // Simplified redraw - in a real app you might replace the step element itself
            this.renderBuilderUI(); 
        }
    }

    createSourceFile() {
        const extension = this.getExtensionForModality(this.currentPipeline.modality);
        return {
            id: 'source_file',
            name: 'Source File',
            filename: `source${extension}`,
            type: this.getFileTypeForModality(this.currentPipeline.modality),
            isSource: true,
            replaceSource: false,
            addToRecord: true
        };
    }

    getExtensionForModality(modality) {
        const extensions = {
            'Image / Photography': '.jpg',
            '3D Model': '.obj',
            'Audio': '.wav',
            'Video': '.mp4',
            'Text / Document': '.txt',
            'Software': '.zip',
            'Structured Information': '.json',
            'Multimodal Dataset': '.zip'
        };
        return extensions[modality] || '.file';
    }

    getFileTypeForModality(modality) {
        const types = {
            'Image / Photography': 'image',
            '3D Model': 'model',
            'Audio': 'audio',
            'Video': 'video',
            'Text / Document': 'document',
            'Software': 'data',
            'Structured Information': 'data',
            'Multimodal Dataset': 'data'
        };
        return types[modality] || 'data';
    }

    generateOutputFiles(component) {
        const outputs = [];
        if (component.outputs) {
            component.outputs.forEach((output, index) => {
                const fileType = this.determineFileType(output);
                this.fileCounter[fileType]++;
                
                outputs.push({
                    id: `${fileType}_${this.fileCounter[fileType]}_${Date.now()}`,
                    name: `${fileType.charAt(0).toUpperCase() + fileType.slice(1)} ${this.fileCounter[fileType]}`,
                    filename: this.generateFilename(output, fileType, this.fileCounter[fileType]),
                    type: fileType,
                    isSource: false,
                    replaceSource: false,
                    addToRecord: true
                });
            });
        }
        return outputs;
    }

    determineFileType(output) {
        const namePattern = output.name_pattern || output.name || '';
        if (namePattern.includes('image') || output.type === 'image/jpeg' || output.type === 'image/png') return 'image';
        if (namePattern.includes('model') || namePattern.includes('glb') || namePattern.includes('obj')) return 'model';
        if (namePattern.includes('audio') || output.type?.startsWith('audio/')) return 'audio';
        if (namePattern.includes('video') || output.type?.startsWith('video/')) return 'video';
        if (output.type === 'application/json' || output.type === 'text/plain') return 'data';
        return 'document';
    }

    generateFilename(output, fileType, counter) {
        const pattern = output.name_pattern || `{original_stem}_output.${this.getDefaultExtension(fileType)}`;
        return pattern.replace('{original_stem}', `file_${counter}`);
    }

    getDefaultExtension(fileType) {
        const extensions = {
            image: 'jpg', model: 'glb', audio: 'wav', video: 'mp4', document: 'txt', data: 'json'
        };
        return extensions[fileType] || 'file';
    }

    updateFileProperty(fileId, property, value) {
        const file = this.findFileById(fileId);
        if (file) {
            file[property] = value;
            this.markAsModified();
            this._syncFileCardUI(fileId);
            this._syncOutputModalUI(fileId, property);
        }
    }

    _syncFileCardUI(fileId) {
        const file = this.findFileById(fileId);
        if (!file) return;
        const card = document.querySelector(`.file-card[data-file-id="${fileId}"]`);
        if (!card) return;
        const recordSwitchInput = card.querySelector('.file-switch[data-property="addToRecord"] input[type="checkbox"]');
        if (recordSwitchInput && recordSwitchInput.checked !== file.addToRecord) {
            recordSwitchInput.checked = file.addToRecord;
        }
    }

    _syncOutputModalUI(fileId, property) {
        const file = this.findFileById(fileId);
        if (!file) return;
        const modal = document.getElementById('outputMappingModal');
        if (modal && !modal.classList.contains('hidden')) {
            const activeItem = modal.querySelector('.output-list-item.active');
            if (activeItem && activeItem.dataset.fileId == fileId) {
                const switchInput = modal.querySelector(`.binary-switch[data-prop="${property}"] input`);
                if (switchInput && switchInput.checked !== file[property]) {
                    switchInput.checked = file[property];
                }
            }
        }
    }

    _recalculateFileCounters(pipeline) {
        this.fileCounter = { image: 0, model: 0, audio: 0, video: 0, document: 0, data: 0 };
        if (!pipeline || !pipeline.steps) return;

        pipeline.steps.forEach(step => {
            (step.outputs || []).forEach(output => {
                const fileType = output.type || 'data';
                const match = output.name.match(/\d+$/);
                if (match) {
                    const number = parseInt(match[0], 10);
                    if (this.fileCounter[fileType] < number) {
                        this.fileCounter[fileType] = number;
                    }
                }
            });
        });
    }

    updateAllFileCardsDisplay(fileName, fileType) {
        // Find all file cards with this name and type and update their checkboxes
        const allFileCards = document.querySelectorAll('.file-card');
        
        allFileCards.forEach(card => {
            const titleElement = card.querySelector('.file-title');
            if (titleElement && titleElement.textContent === fileName) {
                // Find the file data
                const fileId = card.getAttribute('data-file-id');
                let fileData = null;
                
                this.currentPipeline.steps.forEach(step => {
                    [...step.inputs, ...step.outputs].forEach(file => {
                        if (file.name === fileName && file.type === fileType) {
                            fileData = file;
                        }
                    });
                });
                
                if (fileData) {
                    // Update checkboxes in this card
                    const replaceCheckbox = card.querySelector('input[type="checkbox"]');
                    const recordCheckbox = card.querySelectorAll('input[type="checkbox"]')[1];
                    
                    if (replaceCheckbox) {
                        replaceCheckbox.checked = fileData.replaceSource || false;
                    }
                    if (recordCheckbox) {
                        recordCheckbox.checked = fileData.addToRecord !== false;
                    }
                }
            }
        });
    }

    validatePipelineBeforeExport() {
        const issues = [];
        this.currentPipeline.steps.forEach((step, index) => {
            const stepNum = index + 1;
            if (!step.component) {
                issues.push(`Step ${stepNum}: No component selected.`);
            }
            if (stepNum > 1 && step.inputs.length === 0) {
                 issues.push(`Step ${stepNum}: No inputs are connected from previous steps.`);
            }
        });
        return issues;
    }

    generatePipelineYAML(pipeline) {
        if (!pipeline || !pipeline.steps) {
            throw new Error('Invalid pipeline data');
        }
        
        const yaml = {
            name: pipeline.name,
            identifier: pipeline.identifier,
            description: pipeline.description || '',
            modality: pipeline.modality,
            processing_mode: pipeline.processingMode,
            version: pipeline.version || '1.0.0',
            notes: pipeline.notes || '',
            steps: []
        };

        pipeline.steps.forEach((step, index) => {
            const stepData = {
                step: step.stepNumber || (index + 1),
                step_name: step.stepName || `Step ${step.stepNumber || (index + 1)}`
            };
            
            if (step.component) {
                stepData.component = {
                    name: step.component.name,
                    category: step.component.category,
                    version: step.component.version || '1.0.0',
                    parameters: step.component.parameters || {}
                };
            }
            
            if (step.inputMapping && Object.keys(step.inputMapping).length > 0) {
                stepData.input_mapping = step.inputMapping;
            }

            if (step.outputs && step.outputs.length > 0) {
                stepData.outputs = step.outputs.map(output => ({
                    name: output.name,
                    filename_pattern: output.filename,
                    file_type: output.type,
                    // Explicitly include all output properties
                    add_to_record: output.addToRecord,
                    replace_source_file: !!output.replaceSourceFile,
                    output_mapping: output.outputMapping || {}
                }));
            }
            yaml.steps.push(stepData);
        });
        
        // This is a simplified manual conversion.
        let yamlString = `name: ${yaml.name}\nidentifier: ${yaml.identifier}\ndescription: "${yaml.description}"\nmodality: ${yaml.modality}\nprocessing_mode: ${yaml.processing_mode}\nversion: ${yaml.version}\nnotes: "${yaml.notes}"\nsteps:\n`;
        
        yaml.steps.forEach(step => {
            yamlString += `- step: ${step.step}\n`;
            yamlString += `  step_name: "${step.step_name}"\n`;
            if (step.component) {
                yamlString += `  component: ${JSON.stringify(step.component)}\n`;
            }
            if (step.input_mapping) {
                yamlString += `  input_mapping: ${JSON.stringify(step.input_mapping)}\n`;
            }
            if (step.outputs) {
                yamlString += `  outputs:\n`;
                step.outputs.forEach(out => {
                     yamlString += `    - ${JSON.stringify(out)}\n`;
                });
            }
        });

        return yamlString;
    }

    yamlValue(value) {
        if (typeof value === 'string') {
            // Quote strings that need it
            if (value === '' || 
                /^[\d\-]/.test(value) || 
                /[:\[\]{}]/.test(value) || 
                value === 'true' || 
                value === 'false' ||
                value === 'null') {
                return `"${value}"`;
            }
            return value;
        }
        return value;
    }

    async transformDatabasePipeline(dbPipeline) {
        // Transform database format to UI format
        const transformedPipeline = {
            identifier: dbPipeline.identifier,
            name: dbPipeline.name,
            modality: dbPipeline.primary_modality,
            processingMode: dbPipeline.processing_mode,
            description: dbPipeline.description || '',
            version: dbPipeline.version || '1.0.0',
            notes: dbPipeline.notes || '',
            zenodoDraftStepEnabled: dbPipeline.zenodoDraftStepEnabled,
            zenodoUploadStepEnabled: dbPipeline.zenodoUploadStepEnabled,
            zenodoPublishStepEnabled: dbPipeline.zenodoPublishStepEnabled,
            description_constructor_enabled: dbPipeline.description_constructor_enabled || false,
            description_template: dbPipeline.description_template || '',
            steps: []
        };
        
        // Process steps and load their parameters
        for (const step of dbPipeline.steps) {
            const transformedStep = {
                id: `step_${step.step_id}`,
                stepNumber: step.step_number,
                stepName: step.step_name,
                component: null,
                inputs: (step.inputs || []).map(input => this.transformFileFromDB(input)),
                outputs: (step.outputs || []).map(output => this.transformFileFromDB(output)),
                inputMapping: step.inputMapping || {}
            };
            
            if (step.component_name) {
                transformedStep.component = {
                    name: step.component_name,
                    label: step.component_name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
                    category: step.component_category,
                    version: step.component_version || '1.0.0',
                    parameters: step.parameters || {}
                };
                
                // Load saved parameters for this component
                try {
                    const response = await fetch(`${COMPONENT_API_BASE}/${step.component_name}/config`);
                    if (response.ok) {
                        const configData = await response.json();
                        if (configData.parameters && typeof configData.parameters === 'object') {
                            transformedStep.component.parameters = configData.parameters;
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to load parameters for component ${step.component_name}:`, error);
                }
            }
            
            transformedPipeline.steps.push(transformedStep);
        }
        
        return transformedPipeline;
    }

    transformFileFromDB(fileData) {
        const isSource = fileData.is_source_file || false;
        // Ensure all required properties exist with defaults
        return {
            // Use the conceptual_id from the DB as the frontend's primary 'id'
            id: isSource ? 'source_file' : (fileData.conceptual_id || `file_${Date.now()}_${Math.random()}`),
            name: fileData.file_name || 'Unknown File',
            filename: fileData.filename_pattern || 'unknown.file',
            type: fileData.file_type || 'data',
            isSource: isSource,
            replaceSource: fileData.replace_source_file || false,
            addToRecord: fileData.add_to_record !== false,
            outputMapping: fileData.outputMapping || { mapToZenodo: false, zenodoMappings: [] }
        };
    }

    showComponentInfo(component) {
        showInfoModal(component);
    }

    showComponentParameters(component, stepId) {
        showConfigModal(component, stepId);
    }

}