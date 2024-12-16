import { jwtDecode } from "jwt-decode";

export function isTokenExpired(token: string) {
    try {
        // Decode the token to get its payload
        const decoded = jwtDecode(token);

        console.log(decoded);
        // Get the current time in seconds
        const currentTime = Math.floor(Date.now() / 1000);
        console.log(currentTime);
        console.log(decoded?.exp);
    
        // Compare the exp claim with the current time
        if ((decoded?.exp ?? 0) < currentTime) {
            console.log("Token is expired");
            return true; // Token is expired
        } else {
            console.log("Token is still valid");
            return false; // Token is still valid
        }
    } catch (error) {
        // Handle errors (e.g., malformed token)
        console.error("Invalid token:", error);
        return true; // If decoding fails, assume token is expired or invalid
    }
}
