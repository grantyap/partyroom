import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";
import {
  artifactRegister as registerActivityArtifact,
  artifactUploadUrl as activityArtifactUploadUrl,
  cancel as cancelActivity,
  claim as claimActivity,
  complete as completeActivity,
  fail as failActivity,
  renew as renewActivity,
  mediaSource as activityMediaSource,
} from "./activities/http";

const http = httpRouter();

authComponent.registerRoutes(http, createAuth);
http.route({
  path: "/activities/workers/claim",
  method: "POST",
  handler: claimActivity,
});
http.route({
  path: "/activities/workers/artifact-upload-url",
  method: "POST",
  handler: activityArtifactUploadUrl,
});
http.route({
  path: "/activities/workers/artifact-register",
  method: "POST",
  handler: registerActivityArtifact,
});
http.route({
  path: "/activities/workers/renew",
  method: "POST",
  handler: renewActivity,
});
http.route({
  path: "/activities/workers/complete",
  method: "POST",
  handler: completeActivity,
});
http.route({
  path: "/activities/workers/fail",
  method: "POST",
  handler: failActivity,
});
http.route({
  path: "/activities/workers/cancel",
  method: "POST",
  handler: cancelActivity,
});
http.route({
  path: "/activities/workers/media-source",
  method: "POST",
  handler: activityMediaSource,
});

export default http;
