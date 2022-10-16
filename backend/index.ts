/**
 * @file Handle video streaming
 * @name index.js
 * @license MIT
 */

// imports
import crypto from "node:crypto";
import fs from "node:fs";

import ws, { WebSocketServer } from "ws";
import { path } from "@ffmpeg-installer/ffmpeg";
import ffmpeg from "fluent-ffmpeg";
ffmpeg.setFfmpegPath(path);

// make sure ./streams exists
if (!fs.existsSync("./streams")) fs.mkdirSync("./streams");

// variables
let streams: { [key: string]: ffmpeg.FfmpegCommand } = {}; // store all streams

let tokenLinks: { [key: string]: string[] } = {};
let tokens: string[] = [];

// start server
const wss = new WebSocketServer({
    port: 8080,
});

wss.on("connection", (ws) => {
    // generate connection token
    const initialToken = crypto.webcrypto.randomUUID();
    let expectedToken = crypto.webcrypto.randomUUID();

    // send ready state
    tokenLinks[initialToken] = [expectedToken];

    tokens.push(initialToken);
    tokens.push(expectedToken);

    ws.send(
        JSON.stringify({
            action: "Ready",
            initialToken: initialToken,
            token: expectedToken,
        })
    );

    // handle message
    ws.on("message", (data: any) => {
        data = data.toString(); // convert buffer to string
        if (!JSON.parse(data)) return ws.close(); // attempt to parse string
        data = JSON.parse(data);

        // must include token, token must also be valid
        if (!data.token) return ws.close();

        // handle two token system
        if (!tokens.includes(data.token)) return ws.close();
        if (!tokenLinks[data.initialToken].includes(data.token))
            return ws.close();

        // handle methods
        switch (data.action) {
            case "Start":
                // create ffmpeg instance and store video
                streams[data.token] = ffmpeg("video.webm");

                // get video length
                ffmpeg.ffprobe("video.webm", function (err, metadata) {
                    // send the "OK" signal
                    ws.send(
                        JSON.stringify({
                            action: "Stream",
                            meta: metadata,
                        })
                    );
                });

                break;

            case "Stream":
                if (!data.mark) return ws.close(); // we need a timestamp!
                if (data.mark.s === undefined) return ws.close(); // we need a start mark!
                if (data.mark.e === undefined) return ws.close(); // we need an end mark!

                const s_video = streams[data.token];
                if (!s_video) return ws.close(); // video must exist!

                s_video.format("mp4"); // set format
                s_video.inputOptions([
                    `-ss ${data.mark.s}`, // start here
                    `-to ${data.mark.e}`, // end here
                ]);

                console.log(`Streaming: ${data.mark.s} to ${data.mark.e}`);

                // on end
                s_video.on("end", (err) => {
                    if (err) return console.error(err);
                    const file = `streams/${data.token}.mp4`;

                    console.log(
                        `Finished Streaming: ${data.mark.s} to ${data.mark.e}`
                    );

                    // delete old token
                    tokens.splice(tokens.indexOf(expectedToken), 1);
                    delete streams[data.token];

                    // generate new token
                    expectedToken = crypto.webcrypto.randomUUID();
                    tokens.push(expectedToken);
                    streams[expectedToken] = ffmpeg("video.webm");

                    // add new token link
                    tokenLinks[initialToken].push(expectedToken);

                    // file saved! send back...
                    setTimeout(() => {
                        if (!fs.existsSync(`streams/${data.token}.mp4`)) return;
                        ws.send(
                            JSON.stringify({
                                action: "Buffer",
                                buffer: fs
                                    .readFileSync(`streams/${data.token}.mp4`)
                                    .toString("base64"),
                                token: expectedToken,
                            })
                        );
                    }, 100);

                    // delete
                    setTimeout(() => {
                        // we need to delete the video because this system works by giving the client the video
                        // as soon as possible, then the client must store it somewhere while the server generates
                        // the next part
                        if (!fs.existsSync(`streams/${data.token}.mp4`)) return;
                        fs.unlinkSync(`streams/${data.token}.mp4`);
                    }, 1000);
                });

                // set output and run
                s_video.save(`streams/${data.token}.mp4`);

                break;

            default:
                ws.close();
                break;
        }
    });

    // handle close
    ws.on("close", () => {
        // delete initial token
        tokens.splice(tokens.indexOf(initialToken), 1);

        // delete expected token
        tokens.splice(tokens.indexOf(expectedToken), 1);

        // delete links
        delete tokenLinks[initialToken];

        // delete video
        if (fs.existsSync(`streams/${expectedToken}`))
            fs.unlinkSync(`streams/${expectedToken}`);
    });
});
