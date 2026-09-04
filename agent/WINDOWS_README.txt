=======================================================
UnFi-PCO Local Agent - Windows Setup Instructions
=======================================================

1. Ensure Docker Desktop is installed and running on this Windows PC.

2. Copy this entire "unifi-pco-agent" folder from the USB drive to a permanent location 
   on your Windows machine (for example: C:\unifi-pco-agent).

3. Double-click "START_AGENT.bat" (or open PowerShell in this folder and run:
   docker compose up -d --build
   docker compose logs -f

4. Open your web browser to the setup portal:
   http://localhost:8080

   In the Web Portal you can:
   - Scan your local network to discover the UniFi Access Console IP
   - Test your UniFi API Token and view detected doors
   - Drag & drop your Firebase "service-account.json" key
   - Save and start the background bridge

5. To stop the agent:
   docker compose down
