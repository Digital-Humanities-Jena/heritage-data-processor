// src/renderer/js/pipeline-constructor/componentInstallationManager.js

import { PYTHON_API_BASE_URL } from '../core/api.js';
import { showToast } from '../core/ui.js';
import { loadAndDisplayPipelineComponents, setInstallationStatus } from '../views/pipelineComponents.js';

let installationInProgress = false;

export default class ComponentInstallationManager {
    constructor() {
        this.currentComponent = null;
        this.installationRequirements = null;
        this.isInstalling = false;
        this.installationCompleted = false;
        this.setupEventListeners();
    }

    setupEventListeners() {
        document.getElementById('closeComponentInstall')?.addEventListener('click', () => this.closeInstallModal());
        document.getElementById('startInstallBtn')?.addEventListener('click', () => this.startInstallation());
        document.getElementById('cancelInstallBtn')?.addEventListener('click', () => this.cancelInstallation());
        document.getElementById('doneInstallBtn')?.addEventListener('click', () => {
            this.closeInstallModal();
        });
    }

    async showInstallModal(component) {
        this.currentComponent = component;
        document.getElementById('installModalTitle').textContent = `Install ${component.label || component.name}`;
        document.getElementById('installComponentName').textContent = component.label || component.name;
        document.getElementById('installComponentDescription').textContent = component.description || 'No description available';

        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipeline_components/${component.name}/config`);
            if (!response.ok) throw new Error(`Failed to load component config: ${response.statusText}`);
            
            const configData = await response.json();
            this.installationRequirements = configData.installation || configData.specification?.installation || {};

            const hasRequirements = (this.installationRequirements.required_files?.length > 0) ||
                                    (this.installationRequirements.optional_files?.length > 0) ||
                                    (this.installationRequirements.system_checks?.length > 0);

            if (!hasRequirements) {
                this.showSimpleInstallModal();
            } else {
                this.showFullInstallModal();
            }
            document.getElementById('componentInstallModal').classList.remove('hidden');
        } catch (error) {
            showToast(`Failed to load installation requirements: ${error.message}`, 'error');
            this.showSimpleInstallModal(); // Fallback to simple install
            document.getElementById('componentInstallModal').classList.remove('hidden');
        }
    }

    setupSystemChecks(systemChecks) {
        const container = document.getElementById('systemChecksContainer');
        container.innerHTML = '';
        
        if (systemChecks.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No specific system requirements</p>';
            return;
        }
        
        systemChecks.forEach(check => {
            const checkDiv = document.createElement('div');
            checkDiv.className = 'system-check-item';
            
            // Perform actual check (simplified)
            let status = 'passed';
            let icon = '✅';
            
            if (check.name === 'python_version') {
                // Could check actual Python version via backend
                status = 'passed';
            } else if (check.name === 'gpu_support') {
                status = check.required ? 'optional' : 'passed';
                icon = check.required ? '⚠️' : 'ℹ️';
            } else if (check.name === 'memory') {
                status = 'optional';
                icon = 'ℹ️';
            }
            
            checkDiv.classList.add(status);
            checkDiv.innerHTML = `
                <span class="check-icon">${icon}</span>
                <span class="check-description">${check.description}</span>
                <span class="check-status text-xs ml-auto">${status === 'passed' ? 'OK' : status === 'optional' ? 'OPTIONAL' : 'REQUIRED'}</span>
            `;
            
            container.appendChild(checkDiv);
        });
    }

    setupRequiredFiles(requiredFiles) {
        const container = document.getElementById('requiredFilesContainer');
        container.innerHTML = '';
        
        if (requiredFiles.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No required files for installation</p>';
            return;
        }
        
        requiredFiles.forEach(fileReq => {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'file-requirement required';
            fileDiv.dataset.fileName = fileReq.name;
            
            fileDiv.innerHTML = `
                <div class="file-requirement-header">
                    ${fileReq.label}
                    <span class="text-red-500 font-bold">*</span>
                </div>
                <div class="file-requirement-description">${fileReq.description}</div>
                <div class="file-selector">
                    <input type="text" 
                           class="file-path-input" 
                           id="file_${fileReq.name}"
                           placeholder="Select ${fileReq.file_type} file..."
                           readonly>
                    <button type="button" 
                            class="file-browse-btn"
                            data-file-name="${fileReq.name}"
                            data-file-extensions="${(fileReq.validation?.file_extensions || []).join(',')}">
                        Browse
                    </button>
                </div>
                ${fileReq.download_info ? `
                    <div class="download-info">
                        💡 <strong>Download:</strong> 
                        <a href="${fileReq.download_info.url}" target="_blank" class="download-link">
                            ${fileReq.download_info.description}
                        </a>
                    </div>
                ` : ''}
            `;
            
            const browseBtn = fileDiv.querySelector('.file-browse-btn');
            browseBtn.addEventListener('click', () => {
                this.selectRequiredFile(fileReq);
            });
            
            container.appendChild(fileDiv);
        });
    }

    setupOptionalFiles(optionalFiles) {
        const container = document.getElementById('optionalFilesContainer');
        container.innerHTML = '';
        
        if (optionalFiles.length === 0) {
            container.innerHTML = '<p class="text-sm text-gray-500">No optional files</p>';
            return;
        }
        
        optionalFiles.forEach(fileReq => {
            const fileDiv = document.createElement('div');
            fileDiv.className = 'file-requirement';
            fileDiv.dataset.fileName = fileReq.name;
            
            fileDiv.innerHTML = `
                <div class="file-requirement-header">${fileReq.label}</div>
                <div class="file-requirement-description">${fileReq.description}</div>
                <div class="file-selector">
                    <input type="text" 
                           class="file-path-input" 
                           id="file_${fileReq.name}"
                           placeholder="Select ${fileReq.file_type} file (optional)..."
                           readonly>
                    <button type="button" 
                            class="file-browse-btn"
                            data-file-name="${fileReq.name}"
                            data-file-extensions="${(fileReq.validation?.file_extensions || []).join(',')}">
                        Browse
                    </button>
                </div>
                ${fileReq.default_content ? `
                    <div class="download-info">
                        💡 Default content will be created if not provided
                    </div>
                ` : ''}
            `;
            
            const browseBtn = fileDiv.querySelector('.file-browse-btn');
            browseBtn.addEventListener('click', () => {
                this.selectRequiredFile(fileReq);
            });
            
            container.appendChild(fileDiv);
        });
    }

    async selectRequiredFile(fileReq) {
        try {
            const extensions = fileReq.validation?.file_extensions || [];
            const result = await window.electronAPI.openFile({
                title: `Select ${fileReq.label}`,
                filters: extensions.length > 0 ? [
                    { 
                        name: `${fileReq.label} Files`, 
                        extensions: extensions.map(ext => ext.replace('.', '')) 
                    },
                    { name: 'All Files', extensions: ['*'] }
                ] : [{ name: 'All Files', extensions: ['*'] }]
            });
            
            if (result) {
                const inputElement = document.getElementById(`file_${fileReq.name}`);
                inputElement.value = result;
                
                // Update visual state
                const fileReqDiv = inputElement.closest('.file-requirement');
                fileReqDiv.classList.add('provided');
                
                // Validate file if requirements specified
                if (fileReq.validation) {
                    await this.validateSelectedFile(result, fileReq);
                }
                
                this.validateInstallationReadiness();
            }
        } catch (error) {
            console.error('Error selecting file:', error);
            showToast(`Failed to select ${fileReq.label}`, 'error');
        }
    }

    async startInstallation() {
        // Safety Check
        if (!this.installationRequirements) {
            const errorMessage = 'CRITICAL: Installation requirements were not loaded. This can happen if the component configuration (component.yaml) is missing, invalid, or has a name that does not match its parent directory. Please check the component and try again.';
            this.addInstallLog('error', `❌ ${errorMessage}`);
            this.setInstallationState(false, true); // Mark as complete (with failure)
            showToast('Installation failed: requirements not loaded.', 'error');
            return;
        }

        if (!this.validateInstallationReadiness()) {
            showToast('Please provide all required files before installation', 'warning');
            return;
        }
        
        const filePaths = {};
        const requiredFiles = this.installationRequirements.required_files || [];
        for (const fileReq of requiredFiles) {
            const inputElement = document.getElementById(`file_${fileReq.name}`);
            if (inputElement.value.trim()) {
                filePaths[fileReq.name] = inputElement.value.trim();
            }
        }
        
        const optionalFiles = this.installationRequirements.optional_files || [];
        for (const fileReq of optionalFiles) {
            const inputElement = document.getElementById(`file_${fileReq.name}`);
            if (inputElement.value.trim()) {
                filePaths[fileReq.name] = inputElement.value.trim();
            }
        }
        
        setInstallationStatus(true);
        this.setInstallationState(true);
        this.updateInstallProgress(0, 'Starting installation...');
        this.addInstallLog('info', 'Sending installation request to the server...');

        // Manually un-hide the progress and log sections
        document.querySelector('.install-progress').classList.remove('hidden');
        document.querySelector('.install-log').classList.remove('hidden');
        
        try {
            const response = await fetch(`${PYTHON_API_BASE_URL}/api/pipeline_components/${this.currentComponent.name}/install`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ file_paths: filePaths })
            });
            
            const result = await response.json();
            if (!response.ok || !result.success) {
                const errorMessage = result.logs && result.logs.length > 0 ? result.logs[0].message : (result.error || 'Failed to initiate installation on the server.');
                throw new Error(errorMessage);
            }

            this.startLogStreaming(result.installation_id);
            
        } catch (error) {
            console.error('[Install] Initiation error:', error);
            this.addInstallLog('error', `❌ Failed to start installation: ${error.message}`);
            this.updateInstallProgress(0, 'Failed to start');
            this.setInstallationState(false, true);
            setInstallationStatus(false);
            showToast(`Installation failed: ${error.message}`, 'error');
        }
    }

    startLogStreaming(installationId) {
        const eventSource = new EventSource(`${PYTHON_API_BASE_URL}/api/pipeline_components/install/stream/${installationId}`);

        eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.message) {
                this.addInstallLog(data.level || 'info', data.message);
            }
            if (data.progress !== undefined) {
                const statusMessage = data.message || `Installation in progress...`;
                this.updateInstallProgress(data.progress, statusMessage);
            }

            // This block runs ONLY when the final "completed" or "failed" message is received
            if (data.status === 'completed' || data.status === 'failed') {
                eventSource.close();
                this.setInstallationState(false, true); // Mark as complete (success or failure)
                setInstallationStatus(false);
                if(data.status === 'completed') {
                    showToast('Component installed successfully!', 'success');
                    this.installationCompleted = true;
                } else {
                    showToast('Component installation failed.', 'error');
                }
            }
        };

        eventSource.onerror = (err) => {
            console.error('EventSource failed:', err);
            this.addInstallLog('error', 'Lost connection to the installation process. The installation may have failed on the server.');
            eventSource.close();
            this.setInstallationState(false, true); // Mark as complete with failure
            setInstallationStatus(false);
        };
    }

    showSimpleInstallModal(component) {
        this.resetInstallationState();

        // Hide file requirements sections
        document.querySelector('.install-required-files').style.display = 'none';
        document.querySelector('.install-optional-files').style.display = 'none';
        document.querySelector('.install-system-checks').style.display = 'none';
        
        // Show simple installation message
        const container = document.getElementById('requiredFilesContainer');
        container.innerHTML = `
            <div class="simple-install-message bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div class="flex items-center gap-2 text-blue-800 font-semibold mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-5 h-5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Ready to Install
                </div>
                <p class="text-blue-700 text-sm">
                    This component doesn't require any additional files or configuration. 
                    Click "Install Component" to proceed with the installation.
                </p>
            </div>
        `;
        
        // Enable install button immediately
        document.getElementById('startInstallBtn').disabled = false;
        document.getElementById('installStatusText').textContent = 'Ready to install';
    }
    
    showFullInstallModal() {
        // Show all sections
        document.querySelector('.install-required-files').style.display = 'block';
        document.querySelector('.install-optional-files').style.display = 'block';
        document.querySelector('.install-system-checks').style.display = 'block';
        
        // Setup system checks, required files, optional files as before
        const systemChecks = this.installationRequirements.system_checks || [];
        this.setupSystemChecks(systemChecks);
        
        const requiredFiles = this.installationRequirements.required_files || [];
        this.setupRequiredFiles(requiredFiles);
        
        const optionalFiles = this.installationRequirements.optional_files || [];
        this.setupOptionalFiles(optionalFiles);
        
        // Reset installation state
        this.resetInstallationState();
    }

    async validateSelectedFile(filePath, fileReq) {
        try {
            // Use browser-compatible path operations instead of Node.js require
            const getFileExtension = (filepath) => {
                const lastDot = filepath.lastIndexOf('.');
                return lastDot !== -1 ? filepath.substring(lastDot).toLowerCase() : '';
            };
            
            const extension = getFileExtension(filePath);
            
            if (fileReq.validation?.file_extensions) {
                const allowedExts = fileReq.validation.file_extensions;
                if (!allowedExts.includes(extension)) {
                    showToast(`Invalid file type. Expected: ${allowedExts.join(', ')}`, 'warning');
                    return false;
                }
            }
            
            // File size validation
            if (fileReq.validation?.min_size_mb) {
                if (window.electronAPI?.getFileStats) {
                    try {
                        const stats = await window.electronAPI.getFileStats(filePath);
                        const fileSizeMB = stats.size / (1024 * 1024);
                        if (fileSizeMB < fileReq.validation.min_size_mb) {
                            showToast(`File too small. Minimum size: ${fileReq.validation.min_size_mb}MB`, 'warning');
                            return false;
                        }
                    } catch (e) {
                        console.warn('Could not check file size via Electron API:', e);
                        showToast('Could not verify file size.', 'info');
                    }
                } else {
                    // This is the fallback for non-Electron environments
                    console.warn('Skipping file size validation: electronAPI.getFileStats not available in this environment.');
                }
            }
            
            return true;
        } catch (error) {
            console.error('Error validating file:', error);
            return false;
        }
    }

    validateInstallationReadiness() {
        const startBtn = document.getElementById('startInstallBtn');
        let isReady = true;
        
        // Check all required files are provided
        const requiredFiles = this.installationRequirements.required_files || [];
        for (const fileReq of requiredFiles) {
            const inputElement = document.getElementById(`file_${fileReq.name}`);
            if (!inputElement.value.trim()) {
                isReady = false;
                break;
            }
        }
        
        startBtn.disabled = !isReady;
        
        const statusText = document.getElementById('installStatusText');
        statusText.textContent = isReady ? 'Ready to install' : 'Please provide all required files';
        
        return isReady;
    }

    setInstallationState(isInstalling, isComplete = false) {
        this.isInstalling = isInstalling;
        installationInProgress = isInstalling; 
        
        const startBtn = document.getElementById('startInstallBtn');
        const cancelBtn = document.getElementById('cancelInstallBtn');
        const doneBtn = document.getElementById('doneInstallBtn');
        const statusText = document.getElementById('installStatusText');
        
        startBtn.classList.add('hidden');
        cancelBtn.classList.add('hidden');
        doneBtn.classList.add('hidden');

        if (isComplete) {
            // State for a completed installation
            doneBtn.classList.remove('hidden');
            statusText.textContent = 'Installation Complete!';
        } else if (isInstalling) {
            // State for an in-progress installation
            cancelBtn.classList.remove('hidden');
            statusText.textContent = 'Installing...';
        } else {
            // Default state before starting
            startBtn.classList.remove('hidden');
            statusText.textContent = 'Ready to install';
        }
    }

    updateInstallProgress(percentage, message) {
        const progressBar = document.getElementById('installProgressBar');
        const progressText = document.getElementById('installProgressText');
        
        if (progressBar) progressBar.style.width = `${percentage}%`;
        if (progressText) progressText.textContent = message;
    }

    addInstallLog(level = 'info', message) {
        const logContent = document.getElementById('installLogContent');
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = document.createElement('div');
        logEntry.className = `log-line log-${level.toLowerCase()}`;
        
        // For stdout/stderr, use a <pre> tag to preserve formatting
        if (level === 'stdout' || level === 'stderr') {
            logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> <span class="log-level">${level.toUpperCase()}:</span><pre class="log-message-pre">${message}</pre>`;
        } else {
            logEntry.innerHTML = `<span class="log-timestamp">[${timestamp}]</span> <span class="log-level">${level.toUpperCase()}:</span> <span class="log-message">${message}</span>`;
        }
        logContent.appendChild(logEntry);

        logContent.scrollTop = logContent.scrollHeight;
    }
    
    cancelInstallation() {
        if (this.isInstalling) {
            // TODO: Add actual cancellation logic here
            this.addInstallLog('warning', 'Installation cancelled by user');
            this.setInstallationState(false);
        }
    }
    
    resetInstallationState() {
        this.setInstallationState(false);
        document.querySelector('.install-progress').classList.add('hidden');
        document.querySelector('.install-log').classList.add('hidden');
        document.getElementById('installLogContent').textContent = '';
        this.updateInstallProgress(0, 'Preparing installation...');
    }
    
    closeInstallModal() {
        if (this.isInstalling) {
            const confirm = window.confirm(
                'Installation is in progress and may take several minutes.\n' +
                'Closing now may result in incomplete installation.\n\n' +
                'Are you sure you want to close?'
            );
            if (!confirm) return;
            
            this.addInstallLog('warning', '⚠️ Installation interrupted by user');
            this.cancelInstallation();
        }
        
        const modal = document.getElementById('componentInstallModal');
        modal.classList.add('hidden');
        this.currentComponent = null;

        // check if a refresh of view is needed
        if (this.installationCompleted) {
            loadAndDisplayPipelineComponents();
            this.installationCompleted = false; // Reset flag after refresh
        }
    }

    showInstallationError(errorData) {
        this.addInstallLog('error', `❌ Installation failed: ${errorData.error}`);
        
        if (errorData.verification_errors) {
            this.addInstallLog('error', 'Verification errors:');
            errorData.verification_errors.forEach(error => {
                this.addInstallLog('error', `  • ${error}`);
            });
        }
        
        if (errorData.stdout) {
            this.addInstallLog('info', 'Installation output:');
            this.addInstallLog('info', errorData.stdout);
        }
        
        if (errorData.stderr) {
            this.addInstallLog('error', 'Error output:');
            this.addInstallLog('error', errorData.stderr);
        }
    }
}