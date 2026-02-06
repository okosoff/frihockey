const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- DATA STORE ---
let spots = 20;
let players = []; 
let waitlist = [];
const ADMIN_PASSWORD = "9648";

// Game details
let gameLocation = "Vollmer Complex";
let gameTime = "Friday 9:30 PM";

// Player signup password protection
let playerSignupCode = "1234";
let requirePlayerCode = true;
let manualOverride = false;

// Store admin sessions
let adminSessions = {};

// --- TIME FUNCTIONS ---
function getCurrentETTime() {
    const now = new Date();
    const etTime = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return etTime;
}

function shouldBeLocked() {
    const etTime = getCurrentETTime();
    const day = etTime.getDay();
    const hour = etTime.getHours();
    
    if (day === 6) return true;
    if (day === 0) return true;
    if (day === 1 && hour < 18) return true;
    return false;
}

function checkAutoLock() {
    if (manualOverride) return;
    
    const shouldLock = shouldBeLocked();
    
    if (shouldLock && !requirePlayerCode) {
        requirePlayerCode = true;
        console.log("Auto-locked: Saturday to Monday 6pm ET window active");
    } else if (!shouldLock && requirePlayerCode) {
        requirePlayerCode = false;
        console.log("Auto-unlocked: Monday 6pm ET reached - signup now open");
    }
}

setInterval(checkAutoLock, 60000);
checkAutoLock();

// --- HELPER FUNCTIONS ---
function assignTeam() {
    const whiteCount = players.filter(p => p.team === 'White').length;
    const darkCount = players.filter(p => p.team === 'Dark').length;
    return whiteCount <= darkCount ? 'White' : 'Dark';
}

// --- ROUTES ---
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/waitlist', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'waitlist.html'));
});

// --- PUBLIC API ---

app.get('/api/status', (req, res) => {
    checkAutoLock();
    
    res.json({
        spotsRemaining: spots > 0 ? spots : 0,
        isFull: spots === 0,
        totalPlayers: players.length,
        waitlistCount: waitlist.length,
        requireCode: requirePlayerCode,
        isLockedWindow: shouldBeLocked(),
        location: gameLocation,
        time: gameTime
    });
});

app.get('/api/waitlist', (req, res) => {
    const waitlistNames = waitlist.map((p, index) => ({
        position: index + 1,
        fullName: `${p.firstName} ${p.lastName}`
    }));
    
    res.json({
        waitlist: waitlistNames,
        totalWaitlist: waitlist.length,
        location: gameLocation,
        time: gameTime
    });
});

app.post('/api/verify-code', (req, res) => {
    checkAutoLock();
    
    const { code } = req.body;
    
    if (!requirePlayerCode) {
        return res.json({ valid: true, message: "Signup is open to all" });
    }
    
    if (code === playerSignupCode) {
        res.json({ valid: true });
    } else {
        res.status(401).json({ valid: false, error: "Invalid code" });
    }
});

app.post('/api/register', (req, res) => {
    checkAutoLock();
    
    if (requirePlayerCode) {
        const { signupCode } = req.body;
        if (signupCode !== playerSignupCode) {
            return res.status(401).json({ error: "Invalid or missing signup code" });
        }
    }
    
    const { firstName, lastName, phone, paymentMethod } = req.body;

    if (!firstName || !lastName || !phone || !paymentMethod) {
        return res.status(400).json({ error: "All fields are required." });
    }

    if (spots > 0) {
        const newPlayer = {
            id: Date.now(),
            firstName,
            lastName,
            phone,
            paymentMethod,
            paid: false,
            team: assignTeam()
        };

        players.push(newPlayer);
        spots--;

        res.json({ 
            success: true, 
            inWaitlist: false,
            message: `You are on Team ${newPlayer.team}! E-transfer $15 to okosoff@outlook.com or pay cash prior to game.`,
            team: newPlayer.team 
        });
    } else {
        const waitlistPlayer = {
            id: Date.now(),
            firstName,
            lastName,
            phone,
            paymentMethod,
            joinedAt: new Date()
        };

        waitlist.push(waitlistPlayer);
        
        res.json({
            success: true,
            inWaitlist: true,
            waitlistPosition: waitlist.length,
            message: "Game is full. You have been added to the waitlist."
        });
    }
});

// --- ADMIN API ---

app.post('/api/admin/check-session', (req, res) => {
    const { sessionToken } = req.body;
    if (adminSessions[sessionToken]) {
        res.json({ loggedIn: true });
    } else {
        res.json({ loggedIn: false });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const sessionToken = Date.now().toString() + Math.random().toString();
        adminSessions[sessionToken] = true;
        res.json({ success: true, sessionToken: sessionToken });
    } else {
        res.status(401).json({ success: false });
    }
});

app.post('/api/admin/players', (req, res) => {
    const { password, sessionToken } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }
    res.json({ spots, players, waitlist, location: gameLocation, time: gameTime });
});

app.post('/api/admin/settings', (req, res) => {
    const { password, sessionToken } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }
    
    res.json({
        code: playerSignupCode,
        requireCode: requirePlayerCode,
        isLockedWindow: shouldBeLocked(),
        manualOverride: manualOverride,
        location: gameLocation,
        time: gameTime
    });
});

app.post('/api/admin/update-details', (req, res) => {
    const { password, sessionToken, location, time } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }
    
    if (location && location.trim().length > 0) {
        gameLocation = location.trim();
    }
    if (time && time.trim().length > 0) {
        gameTime = time.trim();
    }
    
    res.json({ 
        success: true, 
        location: gameLocation,
        time: gameTime
    });
});

app.post('/api/admin/update-code', (req, res) => {
    const { password, sessionToken, newCode } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }
    
    if (!/^\d{4}$/.test(newCode)) {
        return res.status(400).json({ error: "Code must be exactly 4 digits" });
    }
    
    playerSignupCode = newCode;
    res.json({ success: true, code: playerSignupCode, requireCode: requirePlayerCode });
});

app.post('/api/admin/toggle-code', (req, res) => {
    const { password, sessionToken } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }
    
    requirePlayerCode = !requirePlayerCode;
    manualOverride = true;
    
    res.json({ 
        success: true, 
        requireCode: requirePlayerCode,
        manualOverride: manualOverride,
        code: playerSignupCode 
    });
});

app.post('/api/admin/reset-schedule', (req, res) => {
    const { password, sessionToken } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }
    
    manualOverride = false;
    checkAutoLock();
    
    res.json({ 
        success: true, 
        requireCode: requirePlayerCode,
        manualOverride: manualOverride
    });
});

// FIXED: Promote waitlist player with auto team assignment
app.post('/api/admin/promote-waitlist', (req, res) => {
    const { password, sessionToken, waitlistId } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }

    if (spots <= 0) {
        return res.status(400).json({ error: "No spots available to promote player" });
    }

    const index = waitlist.findIndex(p => p.id === waitlistId);
    if (index === -1) {
        return res.status(404).json({ error: "Player not found in waitlist" });
    }

    const player = waitlist.splice(index, 1)[0];
    
    // FIXED: Calculate current team counts and assign evenly
    const whiteCount = players.filter(p => p.team === 'White').length;
    const darkCount = players.filter(p => p.team === 'Dark').length;
    const assignedTeam = whiteCount <= darkCount ? 'White' : 'Dark';
    
    const newPlayer = {
        id: player.id,
        firstName: player.firstName,
        lastName: player.lastName,
        phone: player.phone,
        paymentMethod: player.paymentMethod,
        paid: false,
        team: assignedTeam
    };
    
    players.push(newPlayer);
    spots--;

    res.json({ 
        success: true, 
        player: newPlayer,
        spots: spots
    });
});

app.post('/api/admin/remove-waitlist', (req, res) => {
    const { password, sessionToken, waitlistId } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }

    const index = waitlist.findIndex(p => p.id === waitlistId);
    if (index === -1) {
        return res.status(404).json({ error: "Player not found in waitlist" });
    }

    waitlist.splice(index, 1);
    res.json({ success: true });
});

app.post('/api/admin/add-player', (req, res) => {
    const { password, sessionToken, firstName, lastName, phone, paymentMethod, team, toWaitlist } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }

    if (!firstName || !lastName || !phone) {
        return res.status(400).json({ error: "First name, last name, and phone required" });
    }

    if (toWaitlist) {
        const waitlistPlayer = {
            id: Date.now(),
            firstName,
            lastName,
            phone,
            paymentMethod: paymentMethod || 'Cash',
            joinedAt: new Date()
        };
        waitlist.push(waitlistPlayer);
        res.json({ success: true, player: waitlistPlayer, inWaitlist: true });
    } else {
        if (spots <= 0) {
            return res.status(400).json({ error: "No spots available. Use toWaitlist option." });
        }
        
        const newPlayer = {
            id: Date.now(),
            firstName,
            lastName,
            phone,
            paymentMethod: paymentMethod || 'Cash',
            paid: false,
            team: team || assignTeam()
        };
        players.push(newPlayer);
        spots--;
        res.json({ success: true, player: newPlayer, inWaitlist: false });
    }
});

app.post('/api/admin/remove-player', (req, res) => {
    const { password, sessionToken, playerId } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }

    const index = players.findIndex(p => p.id === playerId);
    if (index === -1) {
        return res.status(404).json({ error: "Player not found" });
    }

    players.splice(index, 1);
    spots++;

    res.json({ success: true, spots: spots });
});

app.post('/api/admin/update-spots', (req, res) => {
    const { password, sessionToken, newSpots } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }
    
    const spotCount = parseInt(newSpots);
    if (isNaN(spotCount) || spotCount < 0 || spotCount > 30) {
        return res.status(400).json({ error: "Invalid spot count (0-30 allowed)" });
    }
    
    spots = spotCount;
    res.json({ success: true, spots: spots });
});

app.post('/api/admin/toggle-paid', (req, res) => {
    const { password, sessionToken, playerId } = req.body;
    if (!adminSessions[sessionToken] && password !== ADMIN_PASSWORD) {
        return res.status(401).send("Unauthorized");
    }

    const player = players.find(p => p.id === playerId);
    if (player) {
        player.paid = !player.paid;
        res.json({ success: true, player });
    } else {
        res.status(404).send("Player not found");
    }
});

app.listen(PORT, () => {
    console.log(`Phan's Friday Hockey server running on port ${PORT}`);
    console.log(`Location: ${gameLocation}`);
    console.log(`Time: ${gameTime}`);
});