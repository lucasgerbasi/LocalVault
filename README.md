# LocalVault - A Secure Local Password Manager

## Project Genesis: Solving a Personal Problem

This project began as a direct solution to a personal need. I wanted a password manager that was simple, secure, and completely under my control. I was uncomfortable with my most sensitive data living on a third-party server, and I wanted the peace of mind that comes with local-only storage. Unable to find a tool that was both transparent in its security and simple in its execution, I decided to build my own.

**LocalVault is the result:** a cross-platform desktop application that provides a secure, private, and straightforward way to manage passwords. It operates on a **local-first** principle, meaning your sensitive data is **never** sent to or stored on any cloud server. Everything is encrypted and saved directly on your computer, giving you complete control.

## ✨ Core Features (Version 2)

*   **State-of-the-Art Master Password Protection:** Your master password is protected by **Argon2id**, the current industry gold standard and winner of the Password Hashing Competition, providing superior resistance against modern brute-force attacks.
*   **End-to-End Encryption:** The entire vault is encrypted using **AES-256-GCM**, a modern authenticated encryption cipher that ensures both confidentiality and data integrity.
*   **Secure Local Storage:** Your encrypted vault is stored as a single file (`vault.json`) in your local application data directory.
*   **Full Password Management (CRUD):**
    *   **Create:** Add new password entries with the help of a built-in password generator.
    *   **Read:** Securely copy usernames and passwords to the clipboard.
    *   **Update:** Edit existing entries in a secure modal with a password reveal toggle.
    *   **Delete:** Permanently remove entries from the vault.
*   **Secure Vault Backups:** Easily **Export** your encrypted vault to a safe location and **Import** it to restore your data, all without ever decrypting the contents.
*   **Auto-Lock on Inactivity:** The vault automatically locks after 5 minutes of user inactivity.
*   **Polished User Interface:** A UI with a professional font, real-time search filter, and toast notifications for a smooth user experience.

## 🛡️ Security Philosophy

Security was the primary goal of this project. The architecture was designed to mitigate common threats:
1.  **No Cloud, No Server:** By avoiding a central server, we eliminate the risk of a remote data breach exposing user vaults.
2.  **Zero Knowledge:** The application code has no knowledge of your master password. If you forget it, your data is irrecoverable.
3.  **Tamper-Proof Vault:** The use of AES-256-GCM ensures that if the `vault.json` file is modified or corrupted in any way, decryption will fail, alerting the user to a potential issue.
4.  **Secure by Default:** Features like auto-lock and automatic clipboard clearing are enabled by default to protect users.
5.  **Renderer Process Isolation:** Following Electron's security best practices, `contextBridge` is used to securely expose backend functions to the UI, preventing the renderer process from having access to Node.js APIs.

## 💻 Tech Stack

*   **Framework:** [Electron](https://www.electronjs.org/)
*   **Backend Logic:** [Node.js](https://nodejs.org/) (using built-in `crypto` and `fs` modules)
*   **Key Derivation:** [Argon2](https://www.npmjs.com/package/argon2) (via `argon2` npm package)
*   **Frontend:** HTML5, CSS3, and Vanilla JavaScript (no UI frameworks)
*   **Cryptography:**
    *   **Encryption Cipher:** AES-256-GCM
    *   **Key Derivation Function:** Argon2id

## 🚀 Getting Started

Follow these instructions to get a local copy up and running.

### Prerequisites

You must have [Node.js](https://nodejs.org/en/download/) and `npm` (which comes with Node.js) installed on your system.

### Installation & Running

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/lucasgerbasi/localvault.git
    ```

2.  **Navigate into the project directory:**
    ```bash
    cd localvault
    ```

3.  **Install the dependencies:**
    (This will download Electron, Argon2, and set up the project based on `package.json`).
    ```bash
    npm install
    ```

4.  **Run the application:**
    ```bash
    npm start
    ```

The application window should now launch. On the first run, you will be prompted to create a new, Argon2-secured vault.