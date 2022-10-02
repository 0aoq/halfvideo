const player = document.getElementById("player");
const info = document.getElementById("info");

// functions

let initialToken = "";
let token = "";

let lastStop = 0; // the last end mark
let timeIncrease = 5;
let videoMetadata = {};

let currentBufferNumber = 0;
let buffers = [];

/**
 * @function loadTime
 *
 * @param {WebSocket} socket
 * @param {number} start
 * @param {number} end
 * @returns {void}
 */
function loadTime(socket, start = 0, end = 1) {
    if (token === "") return;
    socket.send(
        JSON.stringify({
            action: "Stream",
            mark: {
                s: start,
                e: end,
            },

            // we use a "two token" system, so to stream you must have a temporary token that changes every stream,
            // and a permanent token that changes every refresh
            initialToken,
            token,
        })
    );
}

/**
 * @function start
 *
 * @param {WebSocket} socket
 * @returns {void}
 */
function start(socket) {
    loadTime(socket, 0, timeIncrease);
    lastStop = timeIncrease;
}

/**
 * @function b64_ab
 * @description Convert base64 to an ArrayBuffer
 *
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function b64_ab(base64) {
    const binary_string = window.atob(base64);
    const len = binary_string.length;
    let bytes = new Uint8Array(len);

    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }

    return bytes.buffer;
}

// establish connection
const socket = new WebSocket("ws://localhost:8080");
let serverIsOpen = false;

socket.addEventListener("open", (event) => {
    // listen for messages
    socket.addEventListener("message", (event) => {
        const data = JSON.parse(event.data); // we'll only ever receive JSON data

        // handle methods
        switch (data.action) {
            case "Ready":
                token = data.token;
                initialToken = data.initialToken;

                // send start
                socket.send(
                    JSON.stringify({
                        action: "Start",
                        initialToken,
                        token,
                    })
                );

                // break
                break;

            case "Stream":
                start(socket);
                videoMetadata = data.meta;
                break;

            case "Buffer":
                // update token
                token = data.token;

                // store buffer
                buffers.push(data.buffer);

                // play first buffer

                if (buffers.length === 1) {
                    player.setAttribute(
                        "src",
                        `data:video/mp4;base64,${buffers[0]}`
                    );
                }

                break;

            default:
                break;
        }
    });

    // listen for close
    socket.addEventListener("close", () => {
        console.log(performance.now(), "Socket closed.");
    });
});

// handle player

// reposition on end
player.addEventListener("play", () => {
    // keep fetching
    loadTime(socket, lastStop, lastStop + timeIncrease);
    lastStop += timeIncrease;
});

player.addEventListener("ended", () => {

    // remove first buffer
    buffers.splice(0, 1);
    currentBufferNumber++;

    // set player src
    player.setAttribute("src", `data:video/mp4;base64,${buffers[0]}`);
});

player.addEventListener("timeupdate", () => {
    info.innerText = `Progress: ${Math.floor(
        player.currentTime + timeIncrease * currentBufferNumber
    )}/${Math.floor(videoMetadata.format.duration)}
    
    Buffers stored: ${buffers.length}
    Current buffer number: ${currentBufferNumber}
    Next buffer size: ${Math.floor(
        b64_ab(buffers[1] || "").byteLength / 1000
    )} MB, increase by: ${Math.floor(
        b64_ab(buffers[1] || "").byteLength / 1000 -
            b64_ab(buffers[0] || "").byteLength / 1000
    )} MB`;
});
