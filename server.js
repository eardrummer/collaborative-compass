const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Fallback routes to serve dashboard and mobile compass client
app.get('/server', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'server.html'));
});

app.get('/client', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'client.html'));
});

// Premium color palette to assign to connected devices
const PREMIUM_COLORS = [
  { name: 'Cyan Glow', hex: '#00f0ff', rgb: '0, 240, 255' },
  { name: 'Neon Rose', hex: '#ff007f', rgb: '255, 0, 127' },
  { name: 'Electric Violet', hex: '#8b00ff', rgb: '139, 0, 255' },
  { name: 'Gold Flame', hex: '#ffd700', rgb: '255, 215, 0' },
  { name: 'Sunset Coral', hex: '#ff5e62', rgb: '255, 94, 98' },
  { name: 'Acid Lime', hex: '#a8ff78', rgb: '168, 255, 120' },
  { name: 'Sapphire Spark', hex: '#3a7bd5', rgb: '58, 123, 213' },
  { name: 'Matrix Emerald', hex: '#00ff87', rgb: '0, 255, 135' }
];

// Store connected clients and controllers
const clients = {};
let controllerSocketId = null;

// Active state of the application, controlled by the server dashboard
let currentAppState = {
  theme: 'default',       // default (black), gradient, matrix, gold-glow
  targetHeading: null,    // target heading in degrees (e.g. 90 for East) or null
  activeAlert: '',        // text pushed by the server
  flashSignal: false,     // true triggers a rapid flash animation
  reflectionPrompt: ''    // prompt for active reflection overlays
};

io.on('connection', (socket) => {
  console.log(`New socket connection established: ${socket.id}`);

  // Identify connection type
  socket.on('register', (data) => {
    const role = data.role; // 'client' or 'controller'
    
    if (role === 'controller') {
      controllerSocketId = socket.id;
      console.log(`Controller registered at socket: ${socket.id}`);
      
      // Send list of already connected clients and current state to new controller
      socket.emit('initialize-controller', {
        clients: Object.values(clients),
        state: currentAppState
      });
    } else if (role === 'client') {
      // Assign a premium color theme to the client
      const clientIndex = Object.keys(clients).length;
      const assignedColor = PREMIUM_COLORS[clientIndex % PREMIUM_COLORS.length];
      
      clients[socket.id] = {
        id: socket.id,
        deviceLabel: `Phone #${clientIndex + 1}`,
        color: assignedColor,
        connectedAt: new Date().toLocaleTimeString(),
        heading: 0,
        isCalibrated: false
      };

      console.log(`Client registered: ${clients[socket.id].deviceLabel} [${assignedColor.name}]`);

      // Send the client its setup details and the current global server state
      socket.emit('initialize-client', {
        identity: clients[socket.id],
        state: currentAppState
      });

      // Notify the controller dashboard
      if (controllerSocketId) {
        io.to(controllerSocketId).emit('client-connected', clients[socket.id]);
      }
    }
  });

  // Handle orientation updates from mobile client
  socket.on('client-orientation', (data) => {
    if (clients[socket.id]) {
      clients[socket.id].heading = data.heading;
      clients[socket.id].isCalibrated = data.isCalibrated;
      
      // Forward to the controller to update dashboard dials
      if (controllerSocketId) {
        io.to(controllerSocketId).emit('client-updated', {
          id: socket.id,
          heading: data.heading,
          isCalibrated: data.isCalibrated
        });
      }
    }
  });

  // Handle calibration notification (e.g. when user taps "Set North")
  socket.on('client-calibrated', () => {
    if (clients[socket.id]) {
      clients[socket.id].isCalibrated = true;
      if (controllerSocketId) {
        io.to(controllerSocketId).emit('client-updated', {
          id: socket.id,
          isCalibrated: true,
          heading: clients[socket.id].heading
        });
      }
    }
  });

  // Handle reflection response submits from clients
  socket.on('client-reflection-submit', (data) => {
    if (clients[socket.id]) {
      const responsePayload = {
        clientId: socket.id,
        deviceLabel: clients[socket.id].deviceLabel,
        color: clients[socket.id].color,
        text: data.text,
        timestamp: new Date().toLocaleTimeString()
      };
      console.log(`Received reflection response from ${clients[socket.id].deviceLabel}: "${data.text}"`);

      // Forward response to the controller dashboard
      if (controllerSocketId) {
        io.to(controllerSocketId).emit('reflection-response-received', responsePayload);
      }
    }
  });

  // Handle command broadcasts sent by the controller
  socket.on('controller-command', (commandData) => {
    console.log('Controller issued command:', commandData);
    
    // Update global state
    currentAppState = {
      ...currentAppState,
      ...commandData
    };

    // Broadcast command to all clients
    socket.broadcast.emit('server-state-change', currentAppState);
  });

  // Clean up on disconnection
  socket.on('disconnect', () => {
    if (socket.id === controllerSocketId) {
      console.log('Controller disconnected.');
      controllerSocketId = null;
    } else if (clients[socket.id]) {
      const leavingClient = clients[socket.id];
      console.log(`Client disconnected: ${leavingClient.deviceLabel}`);
      delete clients[socket.id];
      
      // Notify controller
      if (controllerSocketId) {
        io.to(controllerSocketId).emit('client-disconnected', socket.id);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`=============================================`);
  console.log(`🚀 Web Compass Server Running Successfully!`);
  console.log(`👉 Controller Dashboard: http://localhost:${PORT}/server`);
  console.log(`👉 Mobile Client: http://localhost:${PORT}/client`);
  console.log(`=============================================`);
});
