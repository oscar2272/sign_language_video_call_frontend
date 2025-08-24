// public/service-worker.js
self.addEventListener("push", (event) => {
  const data = event.data.json();

  // 브라우저가 열려 있으면 React Layout으로 전달
  self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      clients.forEach((client) => {
        client.postMessage(data);
      });
    });

  // 브라우저 꺼져있으면 OS 알림
  event.waitUntil(
    self.registration.showNotification("전화가 왔습니다!", {
      body: `${data.from_user}님이 전화를 걸었습니다.`,
      icon: "/icon.png",
      data,
    })
  );
});
