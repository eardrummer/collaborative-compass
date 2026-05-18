const socket = io();

// Mobile active state parameters
let clientIdentity = null;
let globalState = {
  theme: 'default',
  targetHeading: null,
  activeAlert: '',
  flashSignal: false
};

let rawAlpha = 0;
let alphaOffset = 0;
let currentHeading = 0;
let isCalibrated = false;
let sensorsActivated = false;
let hasDirectionSensors = false; // Track absolute coordinate readings availability

// DOM Cache
const overlayScreen = document.getElementById('overlay-screen');
const btnGrantPermission = document.getElementById('btn-grant-permission');
const btnCalibrate = document.getElementById('btn-calibrate');
const compassRing = document.getElementById('compass-ring');
const degreeReadout = document.getElementById('degree-readout');
const headingCardinal = document.getElementById('heading-cardinal');
const targetIndicator = document.getElementById('target-heading-indicator');
const calibrationStatusTag = document.getElementById('calibration-status-tag');
const serverMessageDisplay = document.getElementById('server-message-display');

// Reflection DOM Cache
const reflectionContainer = document.getElementById('reflection-container');
const reflectionPromptText = document.getElementById('reflection-prompt-text');
const reflectionTextarea = document.getElementById('reflection-textarea');
const btnSubmitReflection = document.getElementById('btn-submit-reflection');

// Identity DOM Cache
const identityDot = document.getElementById('identity-dot');
const identityLabel = document.getElementById('identity-label');

// Establish socket connection
socket.on('connect', () => {
  console.log('Connected to server. Registering as mobile client.');
  socket.emit('register', { role: 'client' });
});

// Initialize server-assigned parameters
socket.on('initialize-client', (data) => {
  console.log('Baseline setup loaded:', data);
  clientIdentity = data.identity;
  
  // Apply assigned client label and glowing colors
  identityLabel.textContent = clientIdentity.deviceLabel;
  identityLabel.style.color = clientIdentity.color.hex;
  identityDot.style.backgroundColor = clientIdentity.color.hex;
  identityDot.style.boxShadow = `0 0 10px ${clientIdentity.color.hex}`;

  // Update root custom properties so stylesheet inherits our glowing palette
  document.documentElement.style.setProperty('--accent-color', clientIdentity.color.hex);
  document.documentElement.style.setProperty('--accent-rgb', clientIdentity.color.rgb);

  // Apply starting global state
  handleServerStateChange(data.state);
});

// Watch for global state updates pushed from server dashboard
socket.on('server-state-change', (newState) => {
  console.log('Received state change command:', newState);
  handleServerStateChange(newState);
});

// Apply pushed state changes
function handleServerStateChange(state) {
  globalState = state;

  // 1. Color Backdrop themes
  document.body.className = `theme-${state.theme}`;

  // 2. Custom Broadcast Messages
  const container = document.getElementById('push-message-container');
  if (state.activeAlert && state.activeAlert.trim() !== '') {
    // If the alert text is different or newly pushed, reset minimization so it pops up
    if (serverMessageDisplay.textContent !== state.activeAlert) {
      if (container) container.classList.remove('minimized');
    }
    serverMessageDisplay.textContent = state.activeAlert;
    serverMessageDisplay.classList.add('active');
    if (container) container.classList.add('active');
  } else {
    serverMessageDisplay.textContent = '';
    serverMessageDisplay.classList.remove('active');
    if (container) {
      container.classList.remove('active');
      container.classList.remove('minimized');
    }
  }

  // 3. Guided target compass directions
  updateTargetIndicator();

  // 4. Rapid Strobe Flash Signals + Haptic Pulse
  if (state.flashSignal) {
    document.body.classList.add('flash-triggered');
    
    // Haptic vibration pulse if supported by device
    if ('vibrate' in navigator) {
      navigator.vibrate([120]);
    }

    setTimeout(() => {
      document.body.classList.remove('flash-triggered');
    }, 350);
  }

  // 5. Dynamic Reflection Prompts
  if (state.reflectionPrompt && state.reflectionPrompt.trim() !== '') {
    if (reflectionPromptText.textContent !== state.reflectionPrompt) {
      reflectionPromptText.textContent = state.reflectionPrompt;
      if (reflectionTextarea) {
        reflectionTextarea.value = '';
        reflectionTextarea.disabled = false;
      }
      if (btnSubmitReflection) {
        btnSubmitReflection.disabled = false;
        const span = btnSubmitReflection.querySelector('span');
        if (span) span.textContent = 'SUBMIT RESPONSE';
      }
      if (reflectionContainer) {
        reflectionContainer.classList.add('active');
      }
    }
  } else {
    if (reflectionPromptText) reflectionPromptText.textContent = '';
    if (reflectionContainer) reflectionContainer.classList.remove('active');
  }
}

// Request device orientation sensor streams (iOS Safari requirement)
async function activateSensors() {
  if (sensorsActivated) return;

  // iOS request permission handshake
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permissionState = await DeviceOrientationEvent.requestPermission();
      if (permissionState === 'granted') {
        initializeOrientationListener();
      } else {
        alert('Permission to access device motion sensors was denied.');
        return;
      }
    } catch (error) {
      console.error('DeviceOrientation permission request error:', error);
      alert('Sensor initialization error. Ensure you are loading over a secure context (HTTPS).');
      return;
    }
  } else {
    // Non-iOS devices / Android Chrome / Desktop simulation
    initializeOrientationListener();
  }

  // Fade out permission blocker overlay
  overlayScreen.style.opacity = '0';
  setTimeout(() => {
    overlayScreen.style.display = 'none';
  }, 500);

  sensorsActivated = true;

  // Fallback check: if no absolute orientation events are received within 1000ms, activate manual fallback
  setTimeout(() => {
    if (!hasDirectionSensors) {
      setupManualFallback();
    }
  }, 1000);
}

// Bind browser orientation stream listeners
function initializeOrientationListener() {
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  } else if ('ondeviceorientation' in window) {
    window.addEventListener('deviceorientation', handleOrientation, true);
  } else {
    setupManualFallback();
  }
}

// Primary sensor math
function handleOrientation(event) {
  let heading = null;

  // iOS webkitCompassHeading directly maps device to absolute magnetic North
  if (event.webkitCompassHeading !== undefined && event.webkitCompassHeading !== null) {
    heading = event.webkitCompassHeading;
  } else if (event.alpha !== null && event.alpha !== undefined) {
    // Standard absolute orientation (degrees counter-clockwise around Z)
    heading = (360 - event.alpha) % 360;
  }

  // Fail-safe check for empty readings (some browsers fire once with null values)
  if (heading === null) {
    return;
  }

  // Confirmed: Device has absolute sensor hardware and is actively streaming
  hasDirectionSensors = true;
  isCalibrated = true; // Absolute North requires zero manual setup

  currentHeading = heading;
  
  // Hide manual keys since absolute heading is online
  btnCalibrate.style.display = 'none';
  calibrationStatusTag.textContent = 'Absolute Compass';
  calibrationStatusTag.classList.add('active');

  updateCompassUI();

  // Emit heading update back to the server so the controller is updated in real-time
  socket.emit('client-orientation', {
    heading: currentHeading,
    isCalibrated: isCalibrated
  });
}

// Render calculations on vector SVG compass dials
function updateCompassUI() {
  const roundedHeading = Math.round(currentHeading);
  
  // Update center numbers
  degreeReadout.textContent = String(roundedHeading).padStart(3, '0');

  // Update center cardinal letter based on heading
  headingCardinal.textContent = getCardinalDirection(roundedHeading);

  // Rotate SVG ring face (Negative degree so dial remains oriented to our North)
  compassRing.style.transform = `rotate(${-roundedHeading}deg)`;

  // Sync guided target indicators
  updateTargetIndicator();
}

// Map degree heading ranges to cardinal letters
function getCardinalDirection(heading) {
  const index = Math.round(heading / 45) % 8;
  const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return cardinals[index];
}

// Sync target angle indicators
function updateTargetIndicator() {
  if (globalState.targetHeading !== null && isCalibrated) {
    // Calculate rotation relative to phone screen: TargetAngle - CurrentHeading
    const relativeTargetRotation = (globalState.targetHeading - currentHeading + 360) % 360;
    
    targetIndicator.style.opacity = '1';
    targetIndicator.style.transform = `rotate(${relativeTargetRotation}deg)`;

    // Premium choreography details: If phone is facing the target heading within a 6-degree tolerance, highlight the cardinal North glowing gold!
    const angleDiff = Math.abs(relativeTargetRotation);
    const targetFaced = angleDiff <= 6 || angleDiff >= 354;
    
    const northLabel = document.querySelector('.cardinal-north');
    if (targetFaced) {
      northLabel.style.fill = '#ffd700'; // Golden glow
      northLabel.style.filter = 'drop-shadow(0 0 10px rgba(255, 215, 0, 0.8))';
      
      // Trigger a subtle haptic tick on entering the target zone (only once per alignment)
      if ('vibrate' in navigator && !window.hapticTicked) {
        navigator.vibrate(30);
        window.hapticTicked = true;
      }
    } else {
      northLabel.style.fill = 'var(--accent-color)';
      northLabel.style.filter = `drop-shadow(0 0 6px rgba(var(--accent-rgb), 0.6))`;
      window.hapticTicked = false;
    }
  } else {
    targetIndicator.style.opacity = '0';
  }
}

// Manual drag simulation fallback logic
let isDragging = false;
let startX = 0;
let startHeading = 0;

function setupManualFallback() {
  // Only show set north button if not calibrated yet
  if (!isCalibrated) {
    btnCalibrate.style.display = 'flex';
  }
  calibrationStatusTag.textContent = 'Manual Mode';
  calibrationStatusTag.classList.remove('active');

  // Add swipe/drag listeners on screen to rotate compass face
  document.body.addEventListener('mousedown', dragStart);
  document.body.addEventListener('mousemove', dragMove);
  document.body.addEventListener('mouseup', dragEnd);

  document.body.addEventListener('touchstart', dragStart, { passive: true });
  document.body.addEventListener('touchmove', dragMove, { passive: true });
  document.body.addEventListener('touchend', dragEnd);
}

function dragStart(e) {
  isDragging = true;
  startX = e.clientX || (e.touches && e.touches[0].clientX);
  startHeading = currentHeading;
}

function dragMove(e) {
  if (!isDragging) return;
  const currentX = e.clientX || (e.touches && e.touches[0].clientX);
  const diffX = currentX - startX;

  // Map swipe pixel delta to degrees rotation
  currentHeading = (startHeading - (diffX * 0.4) + 360) % 360;
  updateCompassUI();

  socket.emit('client-orientation', {
    heading: currentHeading,
    isCalibrated: isCalibrated
  });
}

function dragEnd() {
  isDragging = false;
}

// Calibrate Current Direction as relative North (Fallback mode)
function calibrateNorth() {
  if (isCalibrated) return;

  isCalibrated = true;
  
  // Update local UI tag
  calibrationStatusTag.textContent = 'Calibrated';
  calibrationStatusTag.classList.add('active');

  // Hide manual calibration button completely (explicitly, and only once!)
  btnCalibrate.style.display = 'none';

  // Signal calibration update to server
  socket.emit('client-calibrated');

  // Short haptic confirmation click
  if ('vibrate' in navigator) {
    navigator.vibrate(60);
  }

  updateCompassUI();
}

// Event Bindings
btnGrantPermission.addEventListener('click', activateSensors);
btnCalibrate.addEventListener('click', calibrateNorth);

if (btnSubmitReflection) {
  btnSubmitReflection.addEventListener('click', () => {
    const responseText = reflectionTextarea.value.trim();
    if (responseText === '') return;

    // Emit response back to server
    socket.emit('client-reflection-submit', { text: responseText });

    // Lock UI input states for submission visual feedback
    reflectionTextarea.disabled = true;
    btnSubmitReflection.disabled = true;
    const span = btnSubmitReflection.querySelector('span');
    if (span) span.textContent = 'SUBMITTED';

    // Tactical tick haptic vibration
    if ('vibrate' in navigator) {
      navigator.vibrate(45);
    }

    // Smooth fade out animation delay
    setTimeout(() => {
      if (reflectionContainer) {
        reflectionContainer.classList.remove('active');
      }
    }, 1000);
  });
}

// Tap-to-minimize live broadcast alerts
const pushContainer = document.getElementById('push-message-container');
if (pushContainer) {
  pushContainer.addEventListener('click', () => {
    if (pushContainer.classList.contains('active') && !pushContainer.classList.contains('minimized')) {
      pushContainer.classList.add('minimized');
      
      // Short tactile tick on minimizing
      if ('vibrate' in navigator) {
        navigator.vibrate(35);
      }
    }
  });
}

// Automatic sensor check & fallback timer: if sensors are not activated within 1500ms, auto-dismiss blocker and load manual mode!
setTimeout(() => {
  if (!sensorsActivated) {
    console.warn('Sensors not activated in time. Engaging manual fallback.');
    
    // Auto-dismiss overlay screen
    if (overlayScreen) {
      overlayScreen.style.opacity = '0';
      setTimeout(() => {
        overlayScreen.style.display = 'none';
      }, 500);
    }
    
    setupManualFallback();
    sensorsActivated = true;
  }
}, 1500);
