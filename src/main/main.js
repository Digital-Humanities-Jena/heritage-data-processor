// src/main/main.js
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const yaml = require('js-yaml');
const showdown = require('showdown');
const fetch = require('node-fetch');

let mainWindow;
let splashWindow;
let pythonServerProcess;
const PYTHON_SERVER_PORT = 5001;

let resolvedMainConfigDir = '';

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 704,
    height: 384,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    center: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  });
  const splashUrl = `file://${path.join(__dirname, '../renderer/splash.html')}?version=${app.getVersion()}`;
  splashWindow.loadURL(splashUrl);

  splashWindow.on('closed', () => {
    splashWindow = null;
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    icon: path.join(__dirname, '../assets/images/icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    try {
      const configPath = path.join(app.getAppPath(), 'server_app', 'data', 'config.yaml');
      const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

      if (config.core.show_startup_dialog) {
        const changelogPath = path.join(app.getAppPath(), 'CHANGELOG.md');
        const disclaimerPath = path.join(app.getAppPath(), 'DISCLAIMER.md'); // Path to the new file

        const changelogMd = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '# Changelog Not Found';
        const disclaimerMd = fs.existsSync(disclaimerPath) ? fs.readFileSync(disclaimerPath, 'utf8') : '# Disclaimer Not Found';

        const converter = new showdown.Converter();
        const changelogHtml = converter.makeHtml(changelogMd);
        const disclaimerHtml = converter.makeHtml(disclaimerMd);

        // Send both HTML payloads to the window
        mainWindow.webContents.send('show-startup-info', { disclaimerHtml, changelogHtml });
      }
    } catch (e) {
      console.error('Failed to process startup files:', e);
    }
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[Main Process] Main window is ready to show.');
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startPythonServer() {
    return new Promise((resolve, reject) => {
        // Use the actual directory name from your build process.
        const backendDirNameInPkg = 'python_backend'; 
        const executableName = 'HDPBackend' + (process.platform === 'win32' ? '.exe' : '');
        
        let commandToExecute;
        let commandArgs;
        let configPath; 
        const configFileName = 'config.yaml';

        let cwd;

        const enableAlpha = process.argv.includes('--enable-alpha-features');

        if (app.isPackaged) {
            configPath = path.join(process.resourcesPath, 'data', configFileName);
            console.log(`[Main Process] Packaged mode: Determined config.yaml path: ${configPath}`);
            
            commandToExecute = path.join(process.resourcesPath, backendDirNameInPkg, executableName);
            const dataDir = path.join(process.resourcesPath, 'data');
            commandArgs = [
              '--port', PYTHON_SERVER_PORT.toString(), 
              '--config', configPath,
              '--data-dir', dataDir
            ];

            // Set the working directory to the folder containing the Python executable
            cwd = path.join(process.resourcesPath, backendDirNameInPkg);
            
            // Set environment variable so Python can find external resources
            process.env.ELECTRON_RESOURCES_PATH = process.resourcesPath;
            process.env.ELECTRON_DATA_PATH = dataDir;
            
            console.log(`[Main Process] Packaged mode - Executing: ${commandToExecute}`);
            console.log(`[Main Process] Resources path set to: ${process.resourcesPath}`);
            console.log(`[Main Process] Data directory path set to: ${dataDir}`);
        } else {
            // In dev mode, use the actual project structure
            configPath = path.join(__dirname, '..', '..', 'server_app', 'data', configFileName);
            console.log(`[Main Process] Development mode: Determined config.yaml path: ${configPath}`);

            // Define the command and arguments to execute for development mode by running the Python script directly.
            commandToExecute = 'python';
            commandArgs = [
                path.join(__dirname, '..', '..', 'run.py'),
                '--port', PYTHON_SERVER_PORT.toString(),
                '--config', configPath
            ];
            // Set the working directory to the project root in development
            cwd = path.join(__dirname, '..', '..');

            console.log(`[Main Process] Development mode - Executing: ${commandToExecute} ${commandArgs.join(' ')}`);
        }

        if (enableAlpha) {
            commandArgs.push('--enable-alpha-features');
            console.log('[Main Process] --enable-alpha-features flag detected. Passing to Python server.');
        }

        if (!fs.existsSync(configPath)) {
            const configErrorMsg = `Main config.yaml NOT FOUND at resolved path: ${configPath}`;
            console.error(configErrorMsg);
            dialog.showErrorBox("Configuration Error", configErrorMsg);
            return reject(new Error(configErrorMsg));
        }
        
        resolvedMainConfigDir = path.dirname(configPath);
        console.log(`[Main Process] Main config directory set to: ${resolvedMainConfigDir}`);

        try {
            console.log(`[Main Process] Spawning Python server: ${commandToExecute} with args: ${JSON.stringify(commandArgs)}`);
            pythonServerProcess = spawn(commandToExecute, commandArgs, { cwd });

            let pingAttempts = 0;
            const maxPingAttempts = 100;
            let promiseSettled = false;

            const resolvePromise = () => {
                if (!promiseSettled) {
                    promiseSettled = true;
                    resolve();
                }
            };

            const rejectPromise = (error) => {
                if (!promiseSettled) {
                    promiseSettled = true;
                    reject(error);
                }
            };

            const pingServer = () => {
                if (promiseSettled) return;

                pingAttempts++;
                console.log(`[Main Process] Pinging Python server... (Attempt ${pingAttempts}/${maxPingAttempts})`);

                if (pingAttempts > maxPingAttempts) {
                    const timeoutError = 'Python server did not respond in time.';
                    console.error(`[Main Process] ${timeoutError}`);
                    if (pythonServerProcess) { 
                        console.log("[Main Process] Max ping attempts reached. Killing Python server process.");
                        try { pythonServerProcess.kill(); } catch(e){ console.error("Error killing server process on timeout:", e); }
                    }
                    return rejectPromise(new Error(timeoutError));
                }

                fetch(`http://localhost:${PYTHON_SERVER_PORT}/api/health`)
                    .then(res => {
                        if (promiseSettled) return;
                        if (res.ok) {
                            console.log('[Main Process] Python server is ready and responding!');
                            resolvePromise(); 
                        } else {
                            setTimeout(pingServer, 500);
                        }
                    })
                    .catch(() => {
                        if (promiseSettled) return;
                        setTimeout(pingServer, 500);
                    });
            };
            setTimeout(pingServer, 1500); 

            pythonServerProcess.stdout.on('data', (data) => console.log(`PythonServer STDOUT: ${data.toString().trim()}`));
            pythonServerProcess.stderr.on('data', (data) => console.error(`PythonServer STDERR: ${data.toString().trim()}`));
            
            pythonServerProcess.on('error', (err) => { 
                const e = `Failed to start Python process: ${err.message}`; 
                console.error(e); 
                dialog.showErrorBox("Backend Error", e); 
                rejectPromise(new Error(e)); 
            });

            pythonServerProcess.on('close', (code) => { 
                const m = `PythonServer process exited with code ${code}`; 
                console.log(m); 
                pythonServerProcess = null; 
                if (code !== 0 && !promiseSettled) { 
                    rejectPromise(new Error(m)); 
                }
            });
        } catch (err) { 
            const e = `Error spawning Python process: ${err.message}`; 
            console.error(e); 
            dialog.showErrorBox("Backend Spawn Error", e); 
            reject(err);
        }
    });
}

function stopPythonServer() {
  if (pythonServerProcess) {
    console.log('Stopping Python server...');
    const result = pythonServerProcess.kill('SIGINT'); 
    if (!result) { // If SIGINT fails or process is stubborn
        pythonServerProcess.kill('SIGTERM');
    }
    pythonServerProcess = null;
  }
}

app.whenReady().then(async () => {
    console.log('[Main Process] Application is ready. Showing splash screen...');
    createSplashWindow();
    
    // Create the main window, but keep it hidden for now.
    createWindow();

    // Function to send status updates to the splash screen
    const sendStatusToSplash = (message) => {
        if (splashWindow && splashWindow.webContents) {
            splashWindow.webContents.send('splash-status-update', message);
        }
    };

    console.log('[Main Process] Starting backend server...');
    sendStatusToSplash('Starting backend server...');

    try {
        // Wait for the Python server to fully start and be responsive.
        await startPythonServer(); 
        console.log('[Main Process] Backend server started successfully.');
        sendStatusToSplash('Backend server is ready!');

        if (mainWindow) {
            mainWindow.webContents.send('server-ready');
        }

        // After everything is loaded, show the main window and close the splash screen.
        if (mainWindow) {
            mainWindow.show();
        }
        if (splashWindow) {
            splashWindow.close();
        }
        
        // --- App lifecycle event listeners are safely registered here ---
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
                mainWindow.show();
            }
        });

    } catch (error) {
        console.error('[Main Process] CRITICAL: Failed to start application:', error);
        dialog.showErrorBox('Fatal Error', `The backend server failed to start, so the application cannot continue.\n\nDetails: ${error.message}`);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
  console.log('[Main Process] App is about to quit. Ensuring Python server is stopped.');
  stopPythonServer();
});



// IPC Handler for file open dialog request from renderer
ipcMain.handle('dialog:openFile', async (event, customOptions) => {
  if (!mainWindow) {
    console.error("Main window not available for dialog for 'dialog:openFile'");
    return null;
  }
  const baseProperties = ['openFile', 'showHiddenFiles'];
  let defaultFilters = [
    { name: 'HDPC Packages', extensions: ['hdpc', 'db', 'sqlite'] },
    { name: 'All Files', extensions: ['*'] },
  ];
  let finalProperties = [...baseProperties];
  let finalFilters = [...defaultFilters];

  if (customOptions && typeof customOptions === 'object') {
    if (customOptions.properties && Array.isArray(customOptions.properties)) {
      const propsSet = new Set([...baseProperties, ...customOptions.properties]);
      finalProperties = Array.from(propsSet);
    }
    if (customOptions.filters && Array.isArray(customOptions.filters) && customOptions.filters.length > 0) {
      finalFilters = [...customOptions.filters];
      const hasAllFilesFilter = finalFilters.some(
        f => f.extensions && f.extensions.some(ext => ext === '*')
      );
      if (!hasAllFilesFilter) {
        finalFilters.push({ name: 'All Files', extensions: ['*'] });
      }
    }
  }
  
  const dialogOptions = {
    title: customOptions && customOptions.title ? customOptions.title : 'Open File',
    properties: finalProperties,
    filters: finalFilters,
  };

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, dialogOptions);

  if (canceled || !filePaths || filePaths.length === 0) {
    return null;
  } else {
    const allowMulti = finalProperties.includes('multiSelections');
    return allowMulti ? filePaths : filePaths[0];
  }
});

// --- IPC Handler for Listing Directory Files ---
ipcMain.handle('dialog:listDirectoryFiles', async (event, directoryPath, recursive) => {
  if (!directoryPath) {
    console.error("[Main Process] listDirectoryFiles: No directoryPath provided.");
    dialog.showErrorBox("Directory Listing Error", "No directory path was provided to list files from.");
    return null; // Indicate error or empty list
  }
  
  const collectedFiles = [];
  const resolvedDirectoryPath = path.resolve(directoryPath); // Ensure absolute path

  console.log(`[Main Process] Listing files in ${resolvedDirectoryPath}, recursive: ${recursive}`);

  async function walkDir(currentPath) {
    try {
      const entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(currentPath, entry.name);
        if (entry.isFile()) {
          collectedFiles.push(entryPath);
        } else if (entry.isDirectory() && recursive) {
          // Check for symbolic links that might point to directories, but avoid infinite loops
          // For simplicity, fs.Dirent.isDirectory() should handle standard directories.
          // If symlinks to directories need to be followed, fs.lstat and fs.readlink might be needed.
          await walkDir(entryPath); // Recurse
        }
      }
    } catch (err) {
      console.error(`[Main Process] Error reading directory ${currentPath}:`, err);
      dialog.showErrorBox(
          "Directory Read Error", 
          `Could not fully read directory: ${currentPath}\n${err.message}\nSome files may be missing from the list.`
      );
    }
  }

  await walkDir(resolvedDirectoryPath); // Initial call to start walking
  
  console.log(`[Main Process] Found ${collectedFiles.length} files in ${resolvedDirectoryPath} (recursive: ${recursive}).`);
  return collectedFiles;
});

// IPC Handler for directory open dialog
ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) {
    console.error("Main window not available for dialog.");
    return null;
  }
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled || filePaths.length === 0) {
    return null;
  } else {
    return filePaths[0]; // Return the absolute path
  }
});

// IPC HANDLER for opening a path externally
ipcMain.handle('shell:openPath', async (event, filePath) => {
  try {
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    console.error(`Failed to open path ${filePath}:`, error);
    return { success: false, error: error.message };
  }
});

// IPC HANDLER for resolving relative paths to open them
ipcMain.handle('shell:resolveAndOpenPath', async (event, pathInfo) => {
  const { basePath, relativePath } = pathInfo;
  if (!basePath || !relativePath) {
    return { success: false, error: "Base path or relative path not provided." };
  }
  try {
    // path.resolve will correctly join basePath and relativePath.
    // If relativePath is already absolute, path.resolve will use it directly.
    const absolutePath = path.resolve(basePath, relativePath);
    console.log(`Attempting to open resolved path: ${absolutePath}`);
    await shell.openPath(absolutePath);
    return { success: true, openedPath: absolutePath };
  } catch (error) {
    console.error(`Failed to resolve/open path (base: ${basePath}, rel: ${relativePath}):`, error);
    return { success: false, error: error.message };
  }
});

// --- IPC Handler for Model Downloads ---
function resolveConfiguredPath(configuredPath, baseDirForRelativePaths) {
    let normalizedPath = configuredPath;
    if (configuredPath.startsWith('~')) {
        normalizedPath = path.join(app.getPath('home'), configuredPath.substring(1));
    }

    if (path.isAbsolute(normalizedPath)) {
        return path.resolve(normalizedPath);
    } else {
        // Resolve relative to the directory of the main config.yaml if baseDirForRelativePaths is provided
        if (!baseDirForRelativePaths) {
            console.error("[Main Process] Cannot resolve relative path: baseDirForRelativePaths is not set.");
            // Fallback to CWD or throw error
            return path.resolve(configuredPath); 
        }
        return path.resolve(baseDirForRelativePaths, normalizedPath);
    }
}

ipcMain.handle('check-model-file-exists', async (event, { configuredModelsPath, filename }) => {
    if (!configuredModelsPath || !filename) {
        return { exists: false, error: "Missing configuredModelsPath or filename.", checkedPath: "" };
    }
    if (!resolvedMainConfigDir) {
        return { exists: false, error: "Main configuration directory not resolved.", checkedPath: "" };
    }

    try {
        const absoluteTargetDir = resolveConfiguredPath(configuredModelsPath, resolvedMainConfigDir);
        const filePath = path.join(absoluteTargetDir, filename);
        const exists = fs.existsSync(filePath);
        console.log(`[Main Process] CheckFileExists: Path='${filePath}', Exists=${exists}`);
        return { exists: exists, checkedPath: filePath };
    } catch (error) {
        console.error(`[Main Process] Error in check-model-file-exists for ${filename}:`, error);
        return { exists: false, error: error.message, checkedPath: configuredModelsPath + "/" + filename };
    }
});

ipcMain.handle('download-model-file', async (event, { downloadUrl, configuredModelsPath, filename }) => {
    if (!mainWindow) return { success: false, error: 'Main window not available.' };
    if (!downloadUrl || !configuredModelsPath || !filename) return { success: false, error: 'Missing parameters.' };
    if (!resolvedMainConfigDir) return { success: false, error: 'Main config directory not resolved.' };

    let absoluteTargetDir;
    try {
        absoluteTargetDir = resolveConfiguredPath(configuredModelsPath, resolvedMainConfigDir);
        if (!fs.existsSync(absoluteTargetDir)) {
            fs.mkdirSync(absoluteTargetDir, { recursive: true });
        }
    } catch (error) {
        console.error(`[Main Process] Error creating/accessing target directory ${configuredModelsPath} (resolved to ${absoluteTargetDir || 'N/A'}):`, error);
        return { success: false, error: `Failed to prepare target directory: ${error.message}` };
    }

    const fullSavePath = path.join(absoluteTargetDir, filename);
    console.log(`[Main Process] Download initiated for ${filename}. Target path: ${fullSavePath}`);
    mainWindow.webContents.send('download-feedback', { filename, success: true, inProgress: true, message: `Starting download for ${filename}...` });

    const session = mainWindow.webContents.session;
    session.removeAllListeners('will-download'); // Clear previous specific listeners
    session.once('will-download', (e, item) => {
        if (item.getURL() === downloadUrl) {
            console.log(`[Main Process] 'will-download' for ${item.getFilename()}. Setting save path to: ${fullSavePath}`);
            item.setSavePath(fullSavePath);
            
            const totalBytes = item.getTotalBytes();
            item.on('updated', (_event, state) => {
                if (state === 'progressing') {
                    const receivedBytes = item.getReceivedBytes();
                    if (mainWindow && mainWindow.webContents && totalBytes > 0) {
                        const progressPercent = Math.round((receivedBytes / totalBytes) * 100);
                        mainWindow.webContents.send('download-model-progress', { filename, progressPercent });
                    }
                } else if (state === 'interrupted') {
                    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('download-model-complete', { filename, success: false, error: `Download interrupted` });
                }
            });
            item.once('done', (_event, state) => {
                if (state === 'completed') {
                    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('download-model-complete', { filename, success: true, path: fullSavePath, message: `${filename} downloaded.` });
                } else {
                    if (mainWindow && mainWindow.webContents) mainWindow.webContents.send('download-model-complete', { filename, success: false, error: `Download failed: ${state}` });
                }
            });
        } else {
            console.warn(`[Main Process] 'will-download' event for unexpected URL: ${item.getURL()}`);
        }
    });
    
    mainWindow.webContents.downloadURL(downloadUrl);
    return { success: true, message: `Download process for ${filename} initiated.` };
});

ipcMain.handle('dialog:save-hdpc', async (event, options) => {
    if (!mainWindow) {
        return { canceled: true, filePath: null };
    }
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Save New Heritage Data Processor Project',
        defaultPath: options.defaultFilename || 'new_project.hdpc',
        filters: [
            { name: 'Heritage Data Processor Project', extensions: ['hdpc'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    return { canceled, filePath };
});

ipcMain.on('set-show-startup-dialog', (event, value) => {
  try {
    const configPath = path.join(app.getAppPath(), 'server_app', 'data', 'config.yaml');
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

    config.core.show_startup_dialog = value;

    fs.writeFileSync(configPath, yaml.dump(config), 'utf8');
  } catch (e) {
    console.error('Failed to write to config file:', e);
  }
});