### The friends view with a request waiting

`GET /api/friends`

`200`, `Cache-Control: no-store`

```json
{
  "friends": [],
  "incoming": [
    {
      "requestId": "98677f18-944b-4d4a-83a9-c72a6b110555",
      "displayName": "riya_1275617466",
      "via": "game",
      "sentAt": 1792494136540
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
      "handle": "jjftp5p8xzps16y4",
      "displayName": "arjun_1279123306",
      "presence": "playing",
      "since": 1792494136953,
      "profile": "jjftp5p8xzps16y4"
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

`GET /api/friends/links/kCgxtEEEBI45eAsVRpnJsg`

`200`, `Cache-Control: no-store`

```json
{
  "invite": {
    "displayName": "A ClassiCade player"
  }
}
```

### A used link: one 404 for used, run out and never made

`POST /api/friends/links/kCgxtEEEBI45eAsVRpnJsg`

`403`, `Cache-Control: no-store`

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Save your progress to add friends",
    "requestId": "fe948c94-1035-4c37-955d-048b42831891"
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
    "requestId": "2c2abcb5-ea67-4e83-8127-40b33e250b81"
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
    "requestId": "7313b5d7-98c8-40af-bb10-5b336c5db93e"
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
    "requestId": "73e85ffd-5d09-4cf5-81fd-3dfd375a8a84"
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
    "requestId": "52dc8925-e0d4-4f78-9d9f-5c2b76818d80"
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
    "requestId": "5694ce34-cb51-4437-bca2-b0770b3f2df1"
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
      "handle": "jjftp5p8xzps16y4",
      "displayName": "arjun_1279123306",
      "presence": "offline",
      "since": 1792494136953,
      "profile": "jjftp5p8xzps16y4"
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
      "requestId": "c754b395-d78e-4547-8a10-ed42da8cdaf9",
      "displayName": "arjun_1279123306",
      "via": "link",
      "sentAt": 1792494139069
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

`POST /api/friends/requests/c754b395-d78e-4547-8a10-ed42da8cdaf9/answer {"answer":"accept"}`

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
    "requestId": "8d14c301-bf65-484b-8d1b-619685899494"
  }
}
```
