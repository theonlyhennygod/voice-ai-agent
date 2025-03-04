# OpenAI Twilio Node.js WebSocket Application

This project integrates OpenAI's language model with Twilio's communication APIs using Node.js and WebSocket. It allows real-time communication and AI-driven responses.

## Features

- Real-time messaging with WebSocket
- AI-driven responses using OpenAI
- Integration with Twilio for SMS and voice communication

## Prerequisites

- Node.js installed
- Twilio account and API credentials
- OpenAI API key

## Installation

1. Clone the repository:
    ```bash
    git clone https://github.com/yourusername/voice-ai-agent.git
    cd voice-ai-agent
    ```

2. Install dependencies:
    ```bash
    npm install
    ```

3. Create a `.env` file and add your credentials:
    ```plaintext
    TWILIO_ACCOUNT_SID=your_twilio_account_sid
    TWILIO_AUTH_TOKEN=your_twilio_auth_token
    OPENAI_API_KEY=your_openai_api_key
    ```

## Usage

1. Start the server:
    ```bash
    npm start
    ```

2. Connect to the WebSocket server at `ws://localhost:3000`.

3. Send messages and receive AI-driven responses.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contact

For questions or support, please contact [yourname@example.com](mailto:yourname@example.com).
# voice-ai-agent
