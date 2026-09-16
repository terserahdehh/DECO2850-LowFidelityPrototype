(() => {

"use strict";


// ==================================================
// PERSON 3 - COLOURING / SWIPE / RESULT CONTROLS
// ==================================================


// --------------------------------------------------
// SHARED SYSTEMS
// --------------------------------------------------

const socket = window.mobileSocket;
const Room = window.Room;


// Make sure Socket.IO exists
if (!socket) {
    console.error("Colouring: mobileSocket was not found.");
    return;
}


// --------------------------------------------------
// STATE
// --------------------------------------------------

let selectedItemId = null;
let completedArtwork = null;

// The word-learned event follows the successful answer event.
window.getCompletedArtwork = (itemId) =>
    completedArtwork?.itemId === itemId ? completedArtwork.image : null;

function saveCompletedArtwork() {
    if (!selectedItemId || !colouringOutline.complete || !colouringOutline.naturalWidth) return;
    const snapshot = document.createElement("canvas");
    snapshot.width = canvas.width;
    snapshot.height = canvas.height;
    const context = snapshot.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, snapshot.width, snapshot.height);
    // Match the outline's CSS padding and object-fit inside the drawing area.
    const bounds = colouringOutline.getBoundingClientRect();
    const padding = parseFloat(getComputedStyle(colouringOutline).paddingLeft);
    const inset = padding * snapshot.width / bounds.width;
    const available = snapshot.width - inset * 2;
    const scale = Math.min(available / colouringOutline.naturalWidth, available / colouringOutline.naturalHeight);
    const width = colouringOutline.naturalWidth * scale;
    const height = colouringOutline.naturalHeight * scale;
    context.drawImage(colouringOutline, (snapshot.width - width) / 2, (snapshot.height - height) / 2, width, height);
    context.globalCompositeOperation = "multiply";
    context.drawImage(canvas, 0, 0);
    completedArtwork = { itemId: selectedItemId, image: snapshot.toDataURL("image/png") };
}

let drawing = false;
let brushColour = "red";

let readyToSubmit = false;
let hasSubmitted = false;

let swipeStartY = null;


// --------------------------------------------------
// ITEM IMAGES
// --------------------------------------------------

const itemImages = {

    carrot: "/assets/eat_objects/carrot.png",
    chicken: "/assets/eat_objects/chicken.png",
    rice: "/assets/eat_objects/rice.png",

    chair: "/assets/sit_objects/chair.png",
    book: "/assets/sit_objects/book.png",
    table: "/assets/sit_objects/table.png",

    butterfly: "/assets/see_objects/butterfly.png",
    tree: "/assets/see_objects/tree.png",
    bird: "/assets/see_objects/bird.png"

};


// --------------------------------------------------
// HTML ELEMENTS
// --------------------------------------------------

const colouringScreen =
    document.getElementById("colouring-screen");

const colouringOutline =
    document.getElementById("colouring-outline");

const canvas =
    document.getElementById("colouring-canvas");

const colourOptions =
    document.getElementById("colour-options");

const doneButton =
    document.getElementById("done-colouring");

const swipeMessage =
    document.getElementById("swipe-message");

const missionCompleteScreen =
    document.getElementById("mission-complete");

const nextMissionButton =
    document.getElementById("next-mission");


// Make sure all required HTML exists
if (
    !colouringScreen ||
    !colouringOutline ||
    !canvas ||
    !colourOptions ||
    !doneButton ||
    !swipeMessage ||
    !missionCompleteScreen ||
    !nextMissionButton
) {

    console.error(
        "Colouring: required HTML elements are missing."
    );

    return;
}


// Canvas drawing context
const ctx = canvas.getContext("2d");


// --------------------------------------------------
// CANVAS SETUP
// --------------------------------------------------

canvas.width = 400;
canvas.height = 400;


// ==================================================
// OPEN COLOURING SCREEN
// Called by Person 2 when pet reaches an item
// ==================================================

window.openColouringScreen = function(itemId) {

    // Make sure item is valid
    if (!itemImages[itemId]) {

        console.error(
            "Unknown itemId:",
            itemId
        );

        return;
    }


    selectedItemId = itemId;
    completedArtwork = null;


    // Reset colouring state
    drawing = false;
    readyToSubmit = false;
    hasSubmitted = false;
    swipeStartY = null;


    // Clear previous colouring
    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    // Reset buttons
    colourOptions.hidden = false;
    doneButton.hidden = false;
    swipeMessage.hidden = true;


    // Load correct item image
    colouringOutline.src =
        itemImages[itemId];


    // Stop room movement AND hide room
    if (Room) {

        Room.lock("colouring");

        Room.hide();
    }


    // Show colouring screen
    colouringScreen.hidden = false;
    socket.emit("colouring-started", { itemId });


    console.log(
        "Colouring item:",
        itemId
    );
};

// ==================================================
// RECEIVE ITEM SELECTION FROM PERSON 2
// ==================================================

document.addEventListener(
    "room:item-selected",
    (event) => {

        const itemId = event.detail?.itemId;

        if (!itemId) {
            console.error(
                "Colouring: room selection did not contain an itemId."
            );

            return;
        }

        console.log(
            "Room selected item:",
            itemId
        );

        window.openColouringScreen(itemId);
    }
);
// ==================================================
// COLOUR BUTTONS
// ==================================================

document
    .querySelectorAll(".colour-btn")
    .forEach((button) => {

        button.addEventListener(
            "click",
            () => {

                brushColour =
                    button.dataset.colour;

                console.log(
                    "Brush colour:",
                    brushColour
                );
            }
        );

    });


// ==================================================
// DRAWING
// ==================================================

canvas.addEventListener(
    "pointerdown",
    (event) => {

        // No more drawing after Done
        if (readyToSubmit) {
            return;
        }

        drawing = true;


        // Helps touch screens and styluses
        canvas.setPointerCapture(
            event.pointerId
        );


        draw(event);
    }
);


canvas.addEventListener(
    "pointermove",
    (event) => {

        if (
            !drawing ||
            readyToSubmit
        ) {
            return;
        }

        draw(event);
    }
);


canvas.addEventListener(
    "pointerup",
    (event) => {

        drawing = false;


        if (
            canvas.hasPointerCapture(
                event.pointerId
            )
        ) {

            canvas.releasePointerCapture(
                event.pointerId
            );
        }
    }
);


canvas.addEventListener(
    "pointercancel",
    () => {

        drawing = false;
    }
);


// --------------------------------------------------
// DRAW FUNCTION
// --------------------------------------------------

function draw(event) {

    const rect =
        canvas.getBoundingClientRect();


    // Convert screen position
    // into canvas position
    const x =
        (event.clientX - rect.left)
        *
        (canvas.width / rect.width);


    const y =
        (event.clientY - rect.top)
        *
        (canvas.height / rect.height);


    ctx.fillStyle =
        brushColour;


    ctx.beginPath();


    ctx.arc(
        x,
        y,
        12,
        0,
        Math.PI * 2
    );


    ctx.fill();
}


// ==================================================
// DONE BUTTON
// ==================================================

doneButton.addEventListener(
    "click",
    finishColouring
);


function finishColouring() {

    // Stop multiple Done presses
    if (readyToSubmit) {
        return;
    }


    drawing = false;


    // Switch to swipe mode
    readyToSubmit = true;


    // Hide colouring controls
    colourOptions.hidden = true;

    doneButton.hidden = true;


    // Tell child to swipe
    swipeMessage.hidden = false;
}


// ==================================================
// SWIPE UP
// ==================================================

colouringScreen.addEventListener(
    "pointerdown",
    (event) => {

        // Swiping only works
        // AFTER Done is pressed
        if (
            !readyToSubmit ||
            hasSubmitted
        ) {
            return;
        }


        swipeStartY =
            event.clientY;
    }
);


colouringScreen.addEventListener(
    "pointerup",
    (event) => {

        if (
            !readyToSubmit ||
            hasSubmitted ||
            swipeStartY === null
        ) {
            return;
        }


        const distance =
            swipeStartY -
            event.clientY;


        // If moved upward more than 80px
        if (distance > 80) {

            submitItem();
        }


        swipeStartY = null;
    }
);


// ==================================================
// SUBMIT ITEM TO SERVER
// ==================================================

function submitItem() {

    // Prevent duplicate submission
    if (
        hasSubmitted ||
        selectedItemId === null
    ) {
        return;
    }


    hasSubmitted = true;


    console.log(
        "Submitting item:",
        selectedItemId
    );


    // SERVER decides whether
    // the answer is correct
    socket.emit(
        "submit-item",
        {
            itemId: selectedItemId
        }
    );
}


// ==================================================
// RECEIVE ANSWER FROM SERVER
// ==================================================

socket.on(
    "answer-result",
    (result) => {

        if (result.correct) {

            saveCompletedArtwork();
            showMissionComplete();

        } else {

            returnToRoom();
        }

    }
);


// ==================================================
// INCORRECT ANSWER
// ==================================================

function returnToRoom() {

    closeColouringScreen();

    if (Room) {

        // Tell Person 2's room that this selection is finished
        Room.finishSelection();

        // Remove our colouring lock
        Room.unlock("colouring");

        // Show room again
        Room.show();
    }
}


// ==================================================
// CLOSE / RESET COLOURING SCREEN
// ==================================================

function closeColouringScreen() {

    // Hide colouring screen
    colouringScreen.hidden = true;


    // Clear colouring canvas
    ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );


    // Reset controls
    colourOptions.hidden = false;

    doneButton.hidden = false;

    swipeMessage.hidden = true;


    // Reset variables
    selectedItemId = null;

    drawing = false;

    readyToSubmit = false;

    hasSubmitted = false;

    swipeStartY = null;
}


// ==================================================
// CORRECT ANSWER
// ==================================================

function showMissionComplete() {

    // Remove colouring UI
    closeColouringScreen();


    // Room stays hidden here
    // because mission is complete


    // Show Mission Complete screen
    missionCompleteScreen.hidden = false;
}


// ==================================================
// NEXT MISSION
// ==================================================

nextMissionButton.addEventListener(
    "click",
    () => {

        // Hide Mission Complete screen
        missionCompleteScreen.hidden = true;


        // Remove colouring lock
        if (Room) {

            Room.unlock("colouring");
        }


        // Ask server for next activity
        socket.emit(
            "next-activity"
        );
    }
);


})();