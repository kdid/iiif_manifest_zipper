var AWS = require("aws-sdk");
const stream = require("stream");
const request = require("request");
const axios = require("axios");
const path = require("path");
const _archiver = require("archiver");
const uuid = require("node-uuid");

const _s3_env = {
  accessKeyId: "minio",
  secretAccessKey: "minio123",
  endpoint: "http://127.0.0.1:9001",
  s3ForcePathStyle: true,
  signatureVersion: "v4"
};

const _bucket = "dev-pyramids";

const streamTo = key => {
  const stream = require("stream");
  const pass = new stream.PassThrough();
  const s3 = new AWS.S3(_s3_env);
  s3.upload({ Bucket: _bucket, Key: key, Body: pass }, (err, data) => {
    /*do something*/
  });
  return pass;
};

async function image_urls(manifest_url) {
  const response = await axios.get(manifest_url);

  let image_urls = [];
  response.data.sequences[0].canvases.forEach((canvas, i) => {
    image_urls.push(canvas.images[0].resource["@id"]);
  });
  return image_urls;
}

async function createArchive(images, manifest_url, key) {
  let uploadStream = streamTo(key);
  let archive = _archiver("zip", {
    zlib: { level: 9 }
  });
  archive.on("error", function(err) {
    throw err;
  });

  uploadStream.on("close", function() {
    console.log(archive.pointer() + " total bytes");
    console.log(
      "archiver has been finalized and the output file descriptor has closed."
    );
  });
  uploadStream.on("end", function() {
    console.log("Data has been drained");
  });
  uploadStream.on("error", function(err) {
    throw err;
  });

  archive.pipe(uploadStream);
  images.forEach(image =>
    archive.append(request(image), { name: `${image.split("/")[5]}.jpg` })
  );
  archive.append(request(manifest_url), { name: "manifest.json" });
  archive.finalize();
}

function respond(status, body) {
  const response = {
    statusCode: status,
    body: body
  };
  console.log(response);
  return response;
}

exports.handler = async event => {
  if (!event.manifest_url || event.manifest_url == null) {
    respond(404, JSON.stringify("Manifest URL not provided."));
  }

  try {
    const manifest_url = event.manifest_url;
    console.log(`Creating zip for: ${manifest_url}`);
    const images = await image_urls(manifest_url);
    const key = path.join("temp", `${uuid.v4()}.zip`);

    await createArchive(images, manifest_url, key);

    const s3 = new AWS.S3(_s3_env);
    const downloadLink = s3.getSignedUrl("getObject", {
      Bucket: _bucket,
      Key: key,
      Expires: 60 * 10
    });

    respond(200, downloadLink);
  } catch (error) {
    console.error(error);
    respond(500, JSON.stringify(error));
  }
};
