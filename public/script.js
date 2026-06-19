// ===================================================================
// --- Configuration from client data ---
// ===================================================================
const courts = [
    { id: 'court_1', name: 'MAIN COURT' }
];

const openHour = 6;
const closeHour = 30; // 2:00 AM the next day

// ===================================================================
// --- State Management ---
// ===================================================================
let selectedSlots = new Set();
let currentDate = new Date().toLocaleDateString('en-CA');
let liveBookings = {};

// ===================================================================
// --- DOM Elements ---
// ===================================================================
const dateInput = document.getElementById('bookingDate');
const timeColumn = document.getElementById('timeColumn');
const courtsWrapper = document.getElementById('courtsWrapper');
const checkoutPanel = document.getElementById('checkoutPanel');
const selectedCountEl = document.getElementById('selectedCount');
const totalCostEl = document.getElementById('totalCost');

// ===================================================================
// --- Database Operations ---
// ===================================================================
// 1. Fetch Live Availability from server
async function fetchAvailability() {
    try {
        const response = await fetch(`/api/bookings/${currentDate}`);
        liveBookings = await response.json();
        renderGrid(); // Redraw grid after getting data
    } catch (error) {
        console.error("Failed to load availability from backend:", error);
        liveBookings = {}; // Fallback so the grid still renders if server is off
        renderGrid(); 
    }
}

// 2. Submit new bookings to server
async function submitBookingToDatabase(status) {
    const slotsArray = Array.from(selectedSlots);
    
    // NEW: Grab the actual customer name and email from the HTML inputs
    const nameInput = document.getElementById('custName').value.trim();
    const emailInput = document.getElementById('custEmail').value.trim();

    // Basic Validation: Ensure they didn't leave it blank
    if (!nameInput || !emailInput) {
        alert("Please enter your Full Name and Email Address before proceeding.");
        return false;
    }
    
    const bookingData = {
        slots: slotsArray,
        status: status, 
        customerName: nameInput,  // Now uses real data
        customerEmail: emailInput // Now uses real data
    };

    try {
        const response = await fetch('http://localhost:3000/api/book', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(bookingData)
        });

        const result = await response.json();

        if (!response.ok) {
            alert("Booking Failed: " + result.message);
            fetchAvailability(); 
            return false; 
        }

        return true; 

    } catch (error) {
        alert("Server error. Please make sure the backend is running.");
        return false;
    }
}

// ===================================================================
// --- Initial Setup & Helpers ---
// ===================================================================
dateInput.min = currentDate;
dateInput.value = currentDate;
dateInput.addEventListener('change', (e) => {
    currentDate = e.target.value;
    selectedSlots.clear(); // Clear selections on date change
    updateCheckout();
    fetchAvailability(); // Fetch new data for the selected date
});

// Helper: Format hour number to display time
function formatHour(h) {
    let rawHour = h % 24;
    const period = h < 12 || h >= 24 ? 'AM' : 'PM';
    let displayHour = rawHour > 12 ? rawHour - 12 : (rawHour === 0 ? 12 : rawHour);
    return `${displayHour}:00 ${period}`;
}

// ===================================================================
// --- Core: Generate and Populate the Grid ---
// ===================================================================
// Helper: Get Price and Label based on the hour
function getPriceTier(h) {
    let actualHour = h % 24; // Converts numbers like 25 into 1:00 AM

    if (actualHour >= 6 && actualHour < 17) {
        // 6:00 AM - 5:00 PM (17:00)
        return { price: 130, label: '₱130', className: 'slot available' };
    } else if (actualHour >= 17 && actualHour <= 23) {
        // 5:00 PM - 12:00 AM
        return { price: 150, label: '⚡ ₱150', className: 'slot available peak' };
    } else {
        // 12:00 AM - 6:00 AM
        return { price: 200, label: '🌙 ₱200', className: 'slot available midnight' };
    }
}

function renderGrid() {
    courtsWrapper.innerHTML = '';
    const oldLabels = timeColumn.querySelectorAll('.time-slot-label');
    oldLabels.forEach(el => el.remove());

    const now = new Date();
    const isToday = currentDate === now.toLocaleDateString('en-CA');
    const currentHour = now.getHours();

    // NEW: Check if the currently selected date on the calendar is a Tue (2) or Fri (5)
    const selectedDayOfWeek = new Date(currentDate + 'T00:00:00').getDay();
    const isRestrictedDay = (selectedDayOfWeek === 2 || selectedDayOfWeek === 5);

    // Render Time Column
    for (let h = openHour; h < closeHour; h++) {
        const label = document.createElement('div');
        label.className = 'time-slot-label';
        label.textContent = `${formatHour(h)} - ${formatHour(h+1)}`;
        timeColumn.appendChild(label);
    }

    // Render Court Columns
    courts.forEach(court => {
        const col = document.createElement('div');
        col.className = 'court-column';
        col.innerHTML = `<div class="grid-header">${court.name}</div>`;

        for (let h = openHour; h < closeHour; h++) {
            const slot = document.createElement('div');
            const slotId = `${currentDate}_${court.id}_${h}`;
            
            const tierInfo = getPriceTier(h); 
            const slotStatus = liveBookings[slotId]; 
            
            const isPast = isToday && (h < currentHour && h < 24);
            
            // NEW: Define the exact hours to block (19 = 7:00 PM, 24 = 12:00 AM)
            const isRestrictedTime = isRestrictedDay && (h >= 19 && h <= 24);

            // UPDATED IF/ELSE LOGIC
            if (isRestrictedTime) {
                // Render as open play
                slot.className = 'slot open-play';
                slot.innerHTML = 'Open Play!';
                slot.title = 'Dedicated Open Play Session';
            } else if (isPast) {
                slot.className = 'slot past';
                slot.textContent = ''; 
            } else if (slotStatus === 'booked') {
                slot.className = 'slot booked';
                slot.textContent = '✕';
                slot.title = 'Fully Booked';
            } else if (slotStatus === 'pending') {
                slot.className = 'slot pending';
                slot.textContent = '⏳';
                slot.title = 'Pending Payment (Walk-in)';
            } else {
                // AVAILABLE
                slot.dataset.id = slotId;
                slot.dataset.price = tierInfo.price;
                slot.dataset.originalLabel = tierInfo.label; // Store this so we can revert back if unselected

                slot.className = tierInfo.className;
                slot.innerHTML = tierInfo.label;

                if (selectedSlots.has(slotId)) {
                    slot.classList.add('selected');
                    slot.textContent = 'Selected';
                }

                slot.addEventListener('click', () => toggleSlotSelection(slot));
            }
            col.appendChild(slot);
        }
        courtsWrapper.appendChild(col);
    });
}

// ===================================================================
// --- Interaction: Select/Unselect Slots ---
// ===================================================================
function toggleSlotSelection(slotElement) {
    const slotId = slotElement.dataset.id;
    const originalLabel = slotElement.dataset.originalLabel; // Pulls the 🌙, ⚡, or standard label

    if (selectedSlots.has(slotId)) {
        selectedSlots.delete(slotId);
        slotElement.classList.remove('selected');
        slotElement.innerHTML = originalLabel; // Reverts perfectly back to the exact tier
    } else {
        selectedSlots.add(slotId);
        slotElement.classList.add('selected');
        slotElement.textContent = 'Selected';
    }
    updateCheckout();
}

// ===================================================================
// --- Core: Calculate Total Cost and Update Panel ---
// ===================================================================
let currentTotalCost = 0; 

function updateCheckout() {
    if (selectedSlots.size > 0) {
        checkoutPanel.classList.add('active');
        selectedCountEl.textContent = selectedSlots.size;
        
        currentTotalCost = 0;
        document.querySelectorAll('.slot.selected').forEach(slot => {
            currentTotalCost += parseInt(slot.dataset.price);
        });
        totalCostEl.textContent = currentTotalCost;
    } else {
        checkoutPanel.classList.remove('active');
    }
}

// ===================================================================
// --- Validation Helper ---
// ===================================================================
function validateCustomerInfo() {
    const nameEl = document.getElementById('custName');
    const emailEl = document.getElementById('custEmail');
    const errorText = document.getElementById('custInfoError');
    
    const nameVal = nameEl.value.trim();
    const emailVal = emailEl.value.trim();
    
    let isValid = true;

    // Check Name
    if (!nameVal) {
        nameEl.classList.add('input-error');
        isValid = false;
    } else {
        nameEl.classList.remove('input-error');
    }

    // Check Email
    if (!emailVal) {
        emailEl.classList.add('input-error');
        isValid = false;
    } else {
        emailEl.classList.remove('input-error');
    }

    // Toggle Error Message
    if (!isValid) {
        errorText.style.display = 'block';
    } else {
        errorText.style.display = 'none';
    }

    return isValid;
}

// ===================================================================
// --- Action Listeners (Buttons) ---
// ===================================================================

// Action 1: Click "Proceed"
document.getElementById('bookBtn').addEventListener('click', async () => {
    const selectedMethod = document.querySelector('input[name="payMethod"]:checked').value;
    const successMsgText = document.querySelector('#successModal p');

    if (selectedMethod === 'online') {
        // --- ONLINE FLOW ---
        document.getElementById('paymentTotal').textContent = currentTotalCost;
        document.getElementById('receipt').value = ''; 
        document.getElementById('receiptError').style.display = 'none'; 
        document.getElementById('paymentModal').style.display = 'flex';
    } else {
        // --- WALK-IN FLOW ---
        const success = await submitBookingToDatabase('pending');
        
        if (success) {
            selectedSlots.clear();
            updateCheckout();
            fetchAvailability(); // Refresh grid
            
            successMsgText.textContent = "Your slots are reserved! Please proceed to the counter to pay upon arrival.";
            document.getElementById('successModal').style.display = 'flex';
        }
    }
});

// Action 2: Cancel Payment
document.getElementById('cancelPaymentBtn').addEventListener('click', () => {
    document.getElementById('paymentModal').style.display = 'none';
});

// Action 3: Confirm Online Payment ("I Have Paid")
document.getElementById('confirmPaymentBtn').addEventListener('click', async () => {
    const receiptInput = document.getElementById('receipt');
    const errorMsg = document.getElementById('receiptError');

    // Validation
    if (receiptInput.files.length === 0) {
        errorMsg.style.display = 'block';
        return; 
    }
    errorMsg.style.display = 'none';

    // --- ONLINE FLOW (Submit to DB) ---
    const success = await submitBookingToDatabase('booked');
    
    if (success) {
        document.getElementById('paymentModal').style.display = 'none';
        selectedSlots.clear();
        updateCheckout();
        fetchAvailability(); // Refresh grid
        
        const successMsgText = document.querySelector('#successModal p');
        successMsgText.textContent = "Your payment is under review. Your slots have been fully booked!";
        document.getElementById('successModal').style.display = 'flex';
    }
});

// Action 4: Close Success Modal
document.getElementById('closeModalBtn').addEventListener('click', () => {
    document.getElementById('successModal').style.display = 'none';
});

// ===================================================================
// --- Initialization ---
// ===================================================================
// Start by fetching data from the server, which then triggers renderGrid()
fetchAvailability();