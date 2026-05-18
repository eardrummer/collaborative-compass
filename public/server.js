const socket = io();

// Dashboard active state mirrors
const connectedDevices = {};
let globalState = {
  theme: 'default',
  targetHeading: null,
  activeAlert: '',
  flashSignal: false
};

// DOM Cache
const clientsGridContainer = document.getElementById('clients-grid-container');
const noClientsMessage = document.getElementById('no-clients-message');
const statConnectedCount = document.getElementById('stat-connected-count');
const statCalibratedCount = document.getElementById('stat-calibrated-count');
const statAvgAngle = document.getElementById('stat-avg-angle');

// Command UI DOM Cache
const themeSelect = document.getElementById('theme-select');
const targetSlider = document.getElementById('target-slider');
const targetAngleDisplay = document.getElementById('target-angle-display');
const btnEnableTarget = document.getElementById('btn-enable-target');
const btnDisableTarget = document.getElementById('btn-disable-target');
const broadcastInput = document.getElementById('broadcast-input');
const btnSendBroadcast = document.getElementById('btn-send-broadcast');
const btnClearBroadcast = document.getElementById('btn-clear-broadcast');
const btnTriggerFlash = document.getElementById('btn-trigger-flash');

// Initialize communication
socket.on('connect', () => {
  console.log('Connected to server. Registering as controller dashboard.');
  socket.emit('register', { role: 'controller' });
});

// Receive baseline connection states
socket.on('initialize-controller', (data) => {
  console.log('Baseline state loaded:', data);
  
  // Restore local state mirror
  globalState = data.state;
  restoreUIState();

  // Add existing clients
  data.clients.forEach(client => {
    addClientCard(client);
  });
  updateStatistics();
});

// Manage incoming mobile connections
socket.on('client-connected', (client) => {
  console.log('New mobile connected:', client);
  addClientCard(client);
  updateStatistics();
});

// Manage incoming client orientation & calibration updates
socket.on('client-updated', (data) => {
  if (connectedDevices[data.id]) {
    const card = connectedDevices[data.id];
    
    // Update values
    if (data.heading !== undefined) {
      card.heading = Math.round(data.heading);
      const needle = document.getElementById(`needle-${data.id}`);
      const headingVal = document.getElementById(`val-${data.id}`);
      
      if (needle) needle.style.transform = `rotate(${card.heading}deg)`;
      if (headingVal) headingVal.textContent = `${card.heading}°`;
    }

    if (data.isCalibrated !== undefined) {
      card.isCalibrated = data.isCalibrated;
      const metadata = document.getElementById(`meta-${data.id}`);
      if (metadata) {
        metadata.textContent = card.isCalibrated ? 'Calibrated Compass' : 'Uncalibrated';
        metadata.style.color = card.isCalibrated ? card.color.hex : 'rgba(255,255,255,0.4)';
      }
    }
    
    updateStatistics();
  }
});

// Clean up leaving clients
socket.on('client-disconnected', (id) => {
  console.log('Mobile disconnected:', id);
  const cardElement = document.getElementById(`card-${id}`);
  if (cardElement) {
    cardElement.remove();
  }
  delete connectedDevices[id];
  updateStatistics();
});

// Render client status card in the dashboard grid
function addClientCard(client) {
  // Prevent duplicate cards
  if (connectedDevices[client.id]) return;

  connectedDevices[client.id] = {
    ...client,
    heading: Math.round(client.heading)
  };

  // Hide "no devices" screen
  noClientsMessage.style.display = 'none';

  const cardHtml = `
    <div class="client-card" id="card-${client.id}">
      <div class="client-card-header">
        <span class="client-title">${client.deviceLabel}</span>
        <span class="client-badge" style="background-color: ${client.color.hex}; box-shadow: 0 0 8px ${client.color.hex};"></span>
      </div>
      
      <div class="mini-compass-wrap">
        <div class="mini-compass-ring"></div>
        <div class="mini-compass-pointer" id="needle-${client.id}" style="--accent-color: ${client.color.hex}; filter: drop-shadow(0 0 4px ${client.color.hex}); transform: rotate(${client.heading}deg)"></div>
      </div>
      
      <span class="client-heading-val" id="val-${client.id}">${client.heading}°</span>
      <span class="client-meta" id="meta-${client.id}" style="color: ${client.isCalibrated ? client.color.hex : 'rgba(255,255,255,0.4)'}">
        ${client.isCalibrated ? 'Calibrated Compass' : 'Uncalibrated'}
      </span>
    </div>
  `;

  clientsGridContainer.insertAdjacentHTML('beforeend', cardHtml);
}

// Recalculate dashboard widgets
function updateStatistics() {
  const deviceList = Object.values(connectedDevices);
  const totalCount = deviceList.length;
  
  // Show placeholder if grid is empty
  if (totalCount === 0) {
    noClientsMessage.style.display = 'flex';
  }

  statConnectedCount.textContent = totalCount;

  const calibratedCount = deviceList.filter(d => d.isCalibrated).length;
  statCalibratedCount.textContent = calibratedCount;

  if (calibratedCount > 0) {
    // Compute correct circular mean (average of angles) to prevent wrap-around error (e.g. avg of 350 and 10 degrees should be 0, not 180!)
    let sumSin = 0;
    let sumCos = 0;
    deviceList.forEach(d => {
      if (d.isCalibrated) {
        const rad = (d.heading * Math.PI) / 180;
        sumSin += Math.sin(rad);
        sumCos += Math.cos(rad);
      }
    });

    let avgRad = Math.atan2(sumSin / calibratedCount, sumCos / calibratedCount);
    let avgDeg = (avgRad * 180) / Math.PI;
    if (avgDeg < 0) avgDeg += 360;

    statAvgAngle.textContent = `${Math.round(avgDeg)}°`;
  } else {
    statAvgAngle.textContent = '-';
  }
}

// Send Commands to server
function pushServerCommand(payload) {
  socket.emit('controller-command', payload);
}

// Sync controller forms to mirror state loaded from connection baseline
function restoreUIState() {
  // Restore color theme selector
  themeSelect.value = globalState.theme;

  // Restore target compass direction states
  if (globalState.targetHeading !== null) {
    targetSlider.disabled = false;
    targetSlider.value = globalState.targetHeading;
    targetAngleDisplay.textContent = `${globalState.targetHeading}°`;
    btnEnableTarget.style.display = 'none';
    btnDisableTarget.style.display = 'block';
  } else {
    targetSlider.disabled = true;
    targetAngleDisplay.textContent = 'None';
    btnEnableTarget.style.display = 'block';
    btnDisableTarget.style.display = 'none';
  }

  // Restore message input
  broadcastInput.value = globalState.activeAlert;
}

// Dashboard Control UI Event Listeners
themeSelect.addEventListener('change', (e) => {
  pushServerCommand({ theme: e.target.value });
});

btnEnableTarget.addEventListener('click', () => {
  const initialAngle = 0;
  targetSlider.disabled = false;
  targetSlider.value = initialAngle;
  targetAngleDisplay.textContent = `${initialAngle}°`;
  btnEnableTarget.style.display = 'none';
  btnDisableTarget.style.display = 'block';

  pushServerCommand({ targetHeading: initialAngle });
});

btnDisableTarget.addEventListener('click', () => {
  targetSlider.disabled = true;
  targetAngleDisplay.textContent = 'None';
  btnEnableTarget.style.display = 'block';
  btnDisableTarget.style.display = 'none';

  pushServerCommand({ targetHeading: null });
});

targetSlider.addEventListener('input', (e) => {
  const angle = parseInt(e.target.value);
  targetAngleDisplay.textContent = `${angle}°`;
  pushServerCommand({ targetHeading: angle });
});

btnSendBroadcast.addEventListener('click', () => {
  const msg = broadcastInput.value.trim();
  pushServerCommand({ activeAlert: msg });
});

btnClearBroadcast.addEventListener('click', () => {
  broadcastInput.value = '';
  pushServerCommand({ activeAlert: '' });
});

btnTriggerFlash.addEventListener('click', () => {
  pushServerCommand({ flashSignal: true });
  
  // Debounce local trigger states immediately
  setTimeout(() => {
    pushServerCommand({ flashSignal: false });
  }, 400);
});
