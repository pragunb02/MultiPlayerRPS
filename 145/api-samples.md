### The friends view with a request waiting

`GET /api/friends`

`200`, `Cache-Control: no-store`

```json
{
  "friends": [],
  "incoming": [
    {
      "requestId": "9d96949a-2a39-487b-a539-d0771016aa75",
      "displayName": "riya_0557888200",
      "via": "game",
      "sentAt": 1792495567002
    }
  ],
  "outgoing": [],
  "settings": {
    "appearOffline": false
  },
  "safetyTips": false
}
```

### The friends view: a friend in a game

`GET /api/friends`

`200`, `Cache-Control: no-store`

```json
{
  "friends": [
    {
      "handle": "3vn691ep1s3t0xs3",
      "displayName": "arjun_5583767663",
      "presence": "playing",
      "since": 1792495567419,
      "profile": "3vn691ep1s3t0xs3"
    }
  ],
  "incoming": [],
  "outgoing": [],
  "settings": {
    "appearOffline": false
  },
  "safetyTips": false
}
```

### A friend link's page for anyone holding it: a minor maker is not named

`GET /api/friends/links/Pa1uSUgWRzBBTlmtZgdUPA`

`200`, `Cache-Control: no-store`

```json
{
  "invite": {
    "displayName": "A ClassiCade player"
  }
}
```

### A used link: one 404 for used, run out and never made

`POST /api/friends/links/Pa1uSUgWRzBBTlmtZgdUPA`

`403`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Save your progress to add friends",
    "requestId": "e5f2d96e-9991-48ff-beac-426a5510130f"
  }
}
```

### A guest asks for the friends view

`GET /api/friends`

`403`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Save your progress to add friends",
    "requestId": "a0cdc6aa-98e4-4153-8675-20ee36bbb3e6"
  }
}
```

### A visitor asks for the friends view

`GET /api/friends`

`401`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "No active session",
    "requestId": "44861f1c-8aed-47de-a27d-51df36da215d"
  }
}
```

### A request id nobody has

`POST /api/friends/requests/00000000-0000-4000-9000-000000000000/answer {"answer":"accept"}`

`404`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "This request is no longer open",
    "requestId": "9570c0bb-657d-441b-9bf7-fe6e95143e51"
  }
}
```

### Asking someone the player never played with

`POST /api/friends/requests {"roomCode":"AB2CD3","seat":1,"seatId":"AAAAAAAAAAAAAAAAAAAAAA"}`

`404`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "You can only add someone you played with",
    "requestId": "450f876e-7910-4a7d-baec-b894130524cd"
  }
}
```

### A player id instead of a seat id is refused before anything is read

`POST /api/friends/requests {"roomCode":"AB2CD3","seat":1,"seatId":"user_0123456789abcdef01234567"}`

`400`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Say who sits in that seat",
    "details": {
      "field": "seatId"
    },
    "requestId": "7e0a53df-d5d1-4835-a526-7beb22975393"
  }
}
```

### Appear offline on

`PUT /api/friends/settings {"appearOffline":true}`

`200`, `Cache-Control: no-store`

```json
{
  "settings": {
    "appearOffline": true
  }
}
```

### The friends view after Arjun appears offline

`GET /api/friends`

`200`, `Cache-Control: no-store`

```json
{
  "friends": [
    {
      "handle": "3vn691ep1s3t0xs3",
      "displayName": "arjun_5583767663",
      "presence": "offline",
      "since": 1792495567419,
      "profile": "3vn691ep1s3t0xs3"
    }
  ],
  "incoming": [],
  "outgoing": [],
  "settings": {
    "appearOffline": false
  },
  "safetyTips": false
}
```

### A minor's friends view (safety tips on)

`GET /api/friends`

`200`, `Cache-Control: no-store`

```json
{
  "friends": [],
  "incoming": [
    {
      "requestId": "e794f028-577c-43e5-b1f0-54403b64930f",
      "displayName": "arjun_5583767663",
      "via": "link",
      "sentAt": 1792495570344
    }
  ],
  "outgoing": [],
  "settings": {
    "appearOffline": false
  },
  "safetyTips": true
}
```

### The minor accepts the request

`POST /api/friends/requests/e794f028-577c-43e5-b1f0-54403b64930f/answer {"answer":"accept"}`

`200`, `Cache-Control: no-store`

```json
{
  "result": "friends"
}
```

### The 21st request in an hour from one player (sends: 20 an hour per player)

`POST /api/friends/links/AbCdEfGhIjKlMnOpQrSt_- (21 times)`

`429`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many friend requests, try again later",
    "requestId": "d7e17294-99f6-4add-8684-3dab1a39f069"
  }
}
```
