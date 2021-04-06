const fs = require("fs");
const fetch = require("node-fetch");
const readline = require("readline");
const { google } = require("googleapis");
const OAuth2Data = require("./credentials.json");
const TOKEN_PATH = "_google_token.json";
const COMMENTERS_PATH = "_youtube_commenters.json";
const VIDEO_ID = "1G0yTHwDcMY";
const CLIENT_ID = OAuth2Data.web.client_id;
const CLIENT_SECRET = OAuth2Data.web.client_secret;
const REDIRECT_URL = OAuth2Data.web.redirect_uris[0];

// If modifying these scopes, delete token.json.
const SCOPES = "https://www.googleapis.com/auth/youtube.force-ssl";
(() => {
  // Authorize with google OAuth2
  authorize()
    .then(async (auth) => {
      // Fetch most recent commenter
      return {
        mostRecentCommenter: await fetchMostRecentCommenter(auth),
        auth,
      };
    })
    .then(async (results) => {
      const { mostRecentCommenter, auth } = results;
      console.log("check if: ", mostRecentCommenter, " is a new commenter");
      const newCommenter = await checkForNewCommenters(mostRecentCommenter);
      return { newCommenter, auth };
    })
    .then(
      async (results) => {
        console.log("do further processing with new commenter");
        const { newCommenter, auth } = results;
        await savePhoto(newCommenter, auth);
        return auth;
      },
      (rejectedReason) => {
        console.log("End of Program: ", rejectedReason);
        return Promise.reject("Dont upload photo.");
      }
    )
    .then(
      (auth) => {
        // upload the photo as the video's thumbnail
        uploadPhoto(auth);
      },
      (rejectedReason) => {
        console.log(rejectedReason);
      }
    )
    .catch((err) => {
      console.log(err);
    });
})();

function authorize() {
  return new Promise((resolve, reject) => {
    const oAuth2Client = new google.auth.OAuth2(
      CLIENT_ID,
      CLIENT_SECRET,
      REDIRECT_URL
    );
    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, async function (err, token) {
      if (err) {
        await getNewToken(oAuth2Client);
        resolve(oAuth2Client);
      } else {
        oAuth2Client.credentials = JSON.parse(token);
        resolve(oAuth2Client);
      }
    });
  });
}

function getNewToken(oAuth2Client) {
  return new Promise((resolve, reject) => {
    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: "offline",
      scope: SCOPES,
    });
    console.log("Authorize this app by visiting this url: ", authUrl);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("Enter the code from that page here: ", function (code) {
      rl.close();
      oAuth2Client.getToken(code, function (err, token) {
        if (err) {
          console.log("Error while trying to retrieve access token", err);
          return;
        }
        oAuth2Client.credentials = token;
        storeToken(token);
        resolve(oAuth2Client);
      });
    });
  });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
    if (err) throw err;
    console.log("Token stored to " + TOKEN_PATH);
  });
}

function fetchMostRecentCommenter(auth) {
  return new Promise((resolve, reject) => {
    const youtube = google.youtube({
      version: "v3",
      auth: auth,
    });
    youtube.commentThreads
      .list({
        part: ["snippet"],
        videoId: VIDEO_ID,
      })
      .then(function (response) {
        // do something with the response
        if (response && response.data && response.data.items) {
          const commentersList = response.data.items.map(
            (a) => a.snippet.topLevelComment.snippet.authorChannelId.value
          );
          if (commentersList.length > 0) {
            resolve(commentersList[0]);
          } else {
            reject("No comments yet on this video!");
          }
        }
      });
  });
}

function checkForNewCommenters(mostRecentCommenter) {
  return new Promise((resolve, reject) => {
    // fetch previous subs from file. If file is empty, return []
    fs.readFile(COMMENTERS_PATH, "utf8", function (err, storedCommenter) {
      if (err || !storedCommenter) {
        err && console.error(err);
        saveCommenter(mostRecentCommenter);
        resolve(mostRecentCommenter);
      }
      if (storedCommenter) {
        // we had some previous subs stored.
        console.log("mostRecentCommenter: ", mostRecentCommenter);
        console.log("storedCommenter: ", storedCommenter);
        if (mostRecentCommenter !== storedCommenter) {
          saveCommenter(mostRecentCommenter);
          resolve(mostRecentCommenter);
        } else {
          reject("No new comments.");
        }
      } else {
        // no comments exist yet in our local file. Return what we fetched from API.
        resolve(mostRecentCommenter);
      }
    });
  });
}

function saveCommenter(commenter) {
  fs.writeFile(COMMENTERS_PATH, commenter, (err) => {
    if (err) throw err;
    console.log("Stored Most Recent Commenter's Name to " + COMMENTERS_PATH);
  });
}

function savePhoto(newCommenter, auth) {
  return new Promise(async (resolve, reject) => {
    const youtube = google.youtube({
      version: "v3",
      auth: auth,
    });
    youtube.channels
      .list({
        part: ["snippet"],
        id: [newCommenter.toString()],
      })
      .then(async (response) => {
        if (response?.data?.items[0]?.snippet?.thumbnails?.high) {
          const photoUrl = response.data.items[0].snippet.thumbnails.high.url;
          try {
            const response = await fetch(photoUrl);
            const buffer = await response.buffer();
            fs.writeFile("./thumbnail.jpeg", buffer, () => {
              console.log("finished saving photo!");
              resolve();
            });
          } catch (error) {
            reject("Failed to save photo: ", error);
          }
        }
      });
  });
}

function uploadPhoto(auth) {
  return new Promise((resolve, reject) => {
    const youtube = google.youtube({
      version: "v3",
      auth: auth,
    });
    try {
      // undocumented method in v3 docs
      youtube.thumbnails.set(
        {
          videoId: VIDEO_ID,
          media: {
            mimeType: "image/jpeg",
            body: fs.createReadStream("thumbnail.jpeg"),
          },
        },
        function (err, uploadResponse, response) {
          if (err) {
            console.error(err);
            reject(err);
          }
          console.log("Successfully uploaded photo!");
          resolve(response);
        }
      );
    } catch (error) {
      reject(error);
    }
  });
}
