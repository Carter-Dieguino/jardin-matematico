const PUBLIC_PREFIX = "/YulizetRamirezLeal";

export default {
  async fetch(request) {
    const incomingUrl = new URL(request.url);

    if (incomingUrl.pathname === PUBLIC_PREFIX) {
      incomingUrl.pathname = `${PUBLIC_PREFIX}/`;
      return Response.redirect(incomingUrl.toString(), 301);
    }

    return new Response("Not found", { status: 404 });
  },
};
