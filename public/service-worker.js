// public/service-worker.js
self.addEventListener("push", (event) => {
  const data = event.data.json();
  if (data.type === "incoming_call") {
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) =>
        client.postMessage({
          type: "incoming_call",
          room_id: data.room_id,
          from_user_id: data.from_user_id, // id
          from_user_name: data.from_user_name, // ✅ 닉네임 포함
        })
      );
    });
  }
});
