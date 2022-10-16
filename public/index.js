const player = document.getElementById("player");
const info = document.getElementById("info");
player.attachShadow({ mode: "open" }); // add shadow

// functions

let initialToken = "";
let token = "";

let lastStop = 0; // the last end mark
let timeIncrease = 10;
let videoMetadata = {};

let currentBufferNumber = 0;
let buffers = [];

let videoSize = { x: "auto", y: "auto" };

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

/**
 * @function addSource
 * @description Add new source and delete old after an interval
 *
 * @param {string} buffer
 * @returns {void}
 */
function addSource(buffer) {
    let cancel = false;

    let vid = `video-${crypto.randomUUID()}`;
    let video;

    player.shadowRoot.innerHTML += `
        <video src="data:video/mp4;base64,${buffer}" id="${vid}" controls autoplay preload="metadata" crossorigin="anonymous" style="
            top: -50; 
            left: -50;
            position: absolute;
            width: 0;
            height: 0;">
    `;

    video = player.shadowRoot.getElementById(vid);
    video.setAttribute("src", `data:video/mp4;base64,${buffer}`);

    // play
    video.play();

    video.addEventListener("loadeddata", () => {
        video.style.position = "static";

        video.style.width = videoSize.x;
        video.style.height = videoSize.y;
        
        player.style.width = videoSize.x;
        player.style.height = videoSize.y;

        // keep track of the wanted size
        videoSize.x = window.getComputedStyle(video).width;
        videoSize.y = window.getComputedStyle(video).height;
    });

    // handle video

    // reposition on end
    video.addEventListener("play", () => {
        if (cancel) return;

        // keep fetching
        loadTime(socket, lastStop, lastStop + timeIncrease);
        lastStop += timeIncrease;
    });

    video.addEventListener("ended", () => {
        cancel = true;

        // remove first buffer
        buffers.splice(0, 1);
        currentBufferNumber++;

        // set player src
        addSource(buffers[0]);

        // handle old video
        video = player.shadowRoot.getElementById(vid); // reset video
        video.remove(); // delete video element
    });

    video.addEventListener("timeupdate", () => {
        if (cancel) return;

        info.innerText = `Progress: ${Math.floor(
            video.currentTime + timeIncrease * currentBufferNumber
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
                if (buffers.length === 1) addSource(buffers[0]);

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
