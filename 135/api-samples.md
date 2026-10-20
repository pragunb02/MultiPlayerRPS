# CC-034 API samples (test accounts only)

### GET /api/profile

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "ypte28fayw029bvs",
    "visibility": "private",
    "canBePublic": true
  }
}
```

### PUT /api/profile/avatar {"avatar":"crown"}

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "ypte28fayw029bvs",
    "avatar": "crown",
    "visibility": "private",
    "canBePublic": true
  }
}
```

### PUT /api/profile/avatar {"avatar":"photo.jpg"}

Status 400, Cache-Control: no-store

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Pick one of the avatars",
    "details": {
      "field": "avatar"
    },
    "requestId": "50cfb84a-f648-4e58-b0ba-a9127745d80d"
  }
}
```

### PUT /api/profile/visibility {"visibility":"public"}

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "ypte28fayw029bvs",
    "avatar": "crown",
    "visibility": "public",
    "canBePublic": true
  }
}
```

### PUT /api/profile/visibility {"visibility":"public"}

Status 403, Cache-Control: no-store

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "Only players aged 18 or over can make their profile public",
    "requestId": "d0719656-b41b-4612-b0e4-cb6fe8f687e8"
  }
}
```

### PUT /api/profile/avatar {"avatar":"fox"}

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "k9t1sva24xekexm7",
    "avatar": "fox",
    "visibility": "private",
    "canBePublic": false
  }
}
```

### PUT /api/profile/avatar {"avatar":"owl"}

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "ax0pmj835thgepe0",
    "avatar": "owl",
    "visibility": "private",
    "canBePublic": true
  }
}
```

### PUT /api/profile/avatar {"avatar":"rocket"}

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "thvy02qzjb8xmy7m",
    "avatar": "rocket",
    "visibility": "private",
    "canBePublic": false
  }
}
```

### GET /api/leaderboards/rock-paper-scissors

Status 200, Cache-Control: (none)

```json
{
  "board": {
    "id": "rock-paper-scissors",
    "name": "Rock Paper Scissors",
    "metric": "wins",
    "period": "all",
    "periodId": "all"
  },
  "entries": [
    {
      "rank": 1,
      "displayName": "RiyaTest",
      "avatar": "crown",
      "profile": "ypte28fayw029bvs",
      "level": 2,
      "score": 1
    },
    {
      "rank": 2,
      "displayName": "Hidden player",
      "hidden": true,
      "level": 1,
      "score": 1
    }
  ]
}
```

### GET /api/profile

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "ypte28fayw029bvs",
    "avatar": "crown",
    "visibility": "public",
    "canBePublic": true
  }
}
```

### GET /api/profile

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "k9t1sva24xekexm7",
    "avatar": "fox",
    "visibility": "private",
    "canBePublic": false
  }
}
```

### GET /api/profile

Status 200, Cache-Control: no-store

```json
{
  "profile": {
    "handle": "ax0pmj835thgepe0",
    "avatar": "owl",
    "visibility": "private",
    "canBePublic": true
  }
}
```

### GET /api/profiles/ypte28fayw029bvs

Status 200, Cache-Control: no-store

```json
{
  "player": {
    "handle": "ypte28fayw029bvs",
    "displayName": "RiyaTest",
    "avatar": "crown",
    "level": 2,
    "stats": {
      "gamesPlayed": 1,
      "wins": 1
    },
    "chess": {
      "rating": 1500,
      "provisional": true,
      "games": 0
    }
  }
}
```

### GET /api/profiles/k9t1sva24xekexm7

Status 200, Cache-Control: no-store

```json
{
  "player": {
    "handle": "k9t1sva24xekexm7",
    "hidden": true,
    "displayName": "Hidden player"
  }
}
```

### GET /api/profiles/ax0pmj835thgepe0

Status 200, Cache-Control: no-store

```json
{
  "player": {
    "handle": "ax0pmj835thgepe0",
    "displayName": "ArjunTest",
    "avatar": "owl",
    "private": true
  }
}
```

### GET /api/profiles/0000000000000000

Status 404, Cache-Control: no-store

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No such player",
    "requestId": "d68d0c7e-e150-45a7-b67e-28ae05efe6da"
  }
}
```

### GET /api/profiles/<handle>, the 31st in a minute from one player

Status 429

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many profiles opened, try again later",
    "requestId": "55431aa1-ea02-4599-9f87-026c91810a42"
  }
}
```

### GET /api/matches?limit=1

Status 200, Cache-Control: (none)

```json
{
  "matches": [
    {
      "matchId": "c2d38753-731b-4101-a0f7-548f444b1a64",
      "gameId": "rps",
      "players": [
        {
          "playerId": "mIbJlIzCqsz7W5V3onByyQ",
          "displayName": "RiyaTest",
          "avatar": "crown",
          "profile": "ypte28fayw029bvs"
        },
        {
          "playerId": "8HbkxqQgOHEq_Syxglrotw",
          "displayName": "Guest-4YJW",
          "avatar": "rocket"
        }
      ],
      "result": {
        "result": "win",
        "winners": [
          "mIbJlIzCqsz7W5V3onByyQ"
        ],
        "reason": "best-of-1"
      },
      "startedAt": 1792483562662,
      "endedAt": 1792483564489,
      "outcomeForYou": "win",
      "countsForYou": {
        "counted": true
      },
      "you": "mIbJlIzCqsz7W5V3onByyQ"
    }
  ],
  "nextBefore": 1792483564489
}
```
