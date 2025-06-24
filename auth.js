import express from "express";
import fetch from "node-fetch";
import { createClient } from "@base44/sdk";

const app = express();
const port = process.env.PORT || 3000;

// הגדר את ה־env בדיוק כמו קודם!
const GOOGLE_CLIENT_ID = "911645783659-mdlv0ee7lvgpecaacr98fspefk3vd2gr.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = process.env.FANLIFT_GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || "https://YOUR-RENDER-URL.onrender.com/auth"; // תעדכן אחרי הפריסה!

app.get("/auth", async (req, res) => {
  const url = req;
  let state = req.query.state || "https://fan-lift.com/UserLogin";

  const redirectToError = (errorMessage) => {
    const errorUrl = new URL(state);
    errorUrl.searchParams.set("auth_error", encodeURIComponent(errorMessage));
    console.error(`[FanliftAuth] ERROR: ${errorMessage}. Redirecting to: ${errorUrl.href}`);
    return res.redirect(errorUrl.href);
  };

  try {
    const base44 = createClient({ appId: process.env.BASE44_APP_ID });
    const code = req.query.code;

    if (!code) {
      return redirectToError("Authorization code missing from Google redirect.");
    }
    if (!GOOGLE_CLIENT_SECRET) {
      return redirectToError("Server configuration error: Google Client Secret is missing.");
    }

    // Step 1: Exchange code for access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      return redirectToError(
        `Google token exchange failed: ${tokenData.error_description || "Unknown error"}`
      );
    }

    // Step 2: Get user info from Google
    const userResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const googleUser = await userResponse.json();
    if (!userResponse.ok) {
      return redirectToError("Failed to get user information from Google.");
    }

    // Step 3: Find or create user in Base44
    const existingUsers = await base44.entities.User.filter({ email: googleUser.email });
    let user;
    if (existingUsers.length > 0) {
      user = existingUsers[0];
    } else {
      user = await base44.entities.User.create({
        email: googleUser.email,
        full_name: googleUser.name || googleUser.email.split("@")[0],
        subscription_status: "none",
        questionnaire_completed: false,
        onboarding_completed: false,
        platform_connected: false,
      });
    }

    // Step 4: Generate a session token using the Base44 SDK
    const sessionToken = await base44.auth.generateSessionToken(user.id);
    if (!sessionToken) {
      return redirectToError("Failed to create a user session token.");
    }

    // Step 5: Redirect back to the original page with the session token
    const finalRedirectUrl = new URL(state);
    finalRedirectUrl.searchParams.set("fanlift_session", sessionToken);
    console.log(`[FanliftAuth] SUCCESS - Redirecting to: ${finalRedirectUrl.href}`);
    return res.redirect(finalRedirectUrl.href);

  } catch (error) {
    console.error("[FanliftAuth] Critical error in OAuth flow:", error);
    return redirectToError(error.message || "An unexpected error occurred.");
  }
});

app.listen(port, () => {
  console.log(`Fanlift OAuth server running on port ${port}`);
});
