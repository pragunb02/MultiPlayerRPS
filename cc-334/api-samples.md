
### Suspend
POST /api/admin/reports/7fafc20f-080b-4ff1-8598-bd3061a7acab/suspension {"duration":"7d","reason":"harassment"}
-> 200 {
  "suspension": {
    "suspensionId": "d1a09f6e-c573-4319-9974-89ea126549c2",
    "nameThen": "BobTest",
    "duration": "7d",
    "reason": "harassment",
    "startedAt": 1792573413049,
    "endsAt": 1793178213049,
    "byName": "Owner",
    "active": true
  },
  "closed": 1
}

### Suspend again
POST /api/admin/reports/7fafc20f-080b-4ff1-8598-bd3061a7acab/suspension {"duration":"24h","reason":"other"}
-> 409 {
  "error": {
    "code": "CONFLICT",
    "message": "This account is suspended already. Lift it first",
    "requestId": "1a655a06-d575-41b7-927c-3dba36e5cf6c"
  }
}

### Free text refused
POST /api/admin/reports/7fafc20f-080b-4ff1-8598-bd3061a7acab/suspension {"duration":"7d","reason":"harassment","note":"rude"}
-> 400 {
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Send only a duration and a reason",
    "details": {
      "fields": [
        "duration",
        "reason"
      ]
    },
    "requestId": "53cb96a2-274d-4251-89de-24950d08c8a1"
  }
}

### Old session
GET /api/session (Bob's cookie from before)
-> 200 {
  "authenticated": false
}

### Sign-in, wrong password
POST /api/auth/login {"email":"bob@example.com","password":"<wrong>"}
-> 401 {
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid email or password",
    "requestId": "5102354a-367c-466b-9562-39ebc9f57da7"
  }
}

### Sign-in, right password
POST /api/auth/login {"email":"bob@example.com","password":"<right>"}
-> 403 {
  "error": {
    "code": "FORBIDDEN",
    "message": "This account is paused for now. If you think this is a mistake, tell us through the feedback form",
    "details": {
      "reason": "suspended",
      "endsAt": 1793178213049
    },
    "requestId": "522b3433-91a2-4010-89d6-8d7e1188df05"
  }
}

### Suspended export (only its suspensions part shown)
POST /api/auth/suspended-export {"email":"bob@example.com","password":"<right>"}
-> 200 {
  "suspensions": [
    {
      "reason": "harassment",
      "duration": "7d",
      "startedAt": "2026-10-21T09:03:33.049Z",
      "endsAt": "2026-10-28T09:03:33.049Z"
    }
  ]
}

### History
GET /api/admin/reports/7fafc20f-080b-4ff1-8598-bd3061a7acab/suspensions
-> 200 {
  "suspensions": [
    {
      "suspensionId": "d1a09f6e-c573-4319-9974-89ea126549c2",
      "nameThen": "BobTest",
      "duration": "7d",
      "reason": "harassment",
      "startedAt": 1792573413049,
      "endsAt": 1793178213049,
      "byName": "Owner",
      "active": true
    }
  ]
}

### Current
GET /api/admin/suspensions
-> 200 {
  "suspensions": [
    {
      "suspensionId": "d1a09f6e-c573-4319-9974-89ea126549c2",
      "nameThen": "BobTest",
      "duration": "7d",
      "reason": "harassment",
      "startedAt": 1792573413049,
      "endsAt": 1793178213049,
      "byName": "Owner",
      "active": true
    }
  ]
}

### Not an admin
GET /api/admin/suspensions (Riya)
-> 404 {
  "error": {
    "code": "NOT_FOUND",
    "message": "Not found",
    "requestId": "282f43c3-2b8d-4243-bc5b-c295cdde9e2a"
  }
}

### Lift
POST /api/admin/suspensions/d1a09f6e-c573-4319-9974-89ea126549c2/lift
-> 200 {
  "suspension": {
    "suspensionId": "d1a09f6e-c573-4319-9974-89ea126549c2",
    "nameThen": "BobTest",
    "duration": "7d",
    "reason": "harassment",
    "startedAt": 1792573413049,
    "endsAt": 1793178213049,
    "byName": "Owner",
    "liftedAt": 1792573413162,
    "liftedByName": "Owner",
    "active": false
  }
}

### Sign-in after the lift
POST /api/auth/login
-> 200 {
  "identity": {
    "kind": "user",
    "id": "user_13345370601bda9c23792605",
    "displayName": "BobTest"
  }
}
