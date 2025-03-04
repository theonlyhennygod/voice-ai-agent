import WebSocket from 'ws';
import dotenv from 'dotenv';
import Fastify from 'fastify';
import fastifyFormBody from '@fastify/formbody';
import fastifyWs from '@fastify/websocket';

// Load environment variables from .env file
dotenv.config();

// Retrieve the OpenAI API key from environment variables
const { OPENAI_API_KEY } = process.env;

if (!OPENAI_API_KEY) {
  console.error('Missing OpenAI API key. Please set it in the .env file.');
  process.exit(1);
}

// Initialize Fastify
const fastify = Fastify();
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

// Constants
const SYSTEM_MESSAGE = `## INSTRUCTIONS:
- You are The senior software engineer, an energetic AI Voice Agent on a mission to transform everyday coders into senior software engineers, people who bend lines of code into digital masterpieces!
- Please make sure to respond with a helpful voice via audio
- Your response should be concise and to the point, keep it short. Bring the conversation back on topic if necessary.
- You can ask the user questions. 

------
## PERSONALITY:
- Be upbeat and super kind
- Speak FAST as if excited

-----
## GOAL: 
- Your primary objective is to identify if the contact is interested in joining the senior software engineer Accelerator program.
- If they express interest, your mission is to provide them with useful information about our services and ultimately retrieve their name and address

## SERVICES INFORMATION:
- The senior software engineer Accelerator program has weekly calls where we discuss state-of-the-art AI topics
- We also have a course teaching you how to build AI apps, and MUCH more!
`
const VOICE = 'ballad'; //alloy
const PORT = process.env.PORT || 5050;

let callerNumber = null;
let callSid = null;

// Session management
const sessions = new Map();

// List of Event Types to log to the console
const LOG_EVENT_TYPES = [
  'response.content.done',
  'rate_limits.updated',
  'response.done',
  'input_audio_buffer.committed',
  'input_audio_buffer.speech_stopped',
  'input_audio_buffer.speech_started',
  'session.created',
  'response.text.done',
  'conversation.item.input_audio_transcription.completed'
];

// Root Route
fastify.get('/', async (request, reply) => {
  reply.send({ message: 'Twilio Media Stream Server is running!' });
});

// Route for Twilio to handle incoming and outgoing calls
fastify.all('/incoming-call', async (request, reply) => {
  console.log('Incoming call');
  // Get all incoming call details from the request body or query string
  const twilioParams = request.body || request.query;

  // Extract caller's number and session ID (CallSid)
  callerNumber = twilioParams.From || null;
  callSid = twilioParams.CallSid;  // Use Twilio's CallSid as a unique session ID
  console.log('Caller Number:', callerNumber);
  console.log('CallSid:', callSid);


  const twimlResponse = `<?xml version="1.0" encoding="UTF-8"?>
                          <Response>
                              <Say>This call will be recorded for quality purposes.</Say>
                              <Connect>
                                  <Stream url="wss://${request.headers.host}/media-stream" />
                              </Connect>
                          </Response>`;

  reply.type('text/xml').send(twimlResponse);
});

// WebSocket route for media-stream
fastify.register(async (fastify) => {
  fastify.get('/media-stream', { websocket: true }, (connection, req) => {
    console.log('Client connected');

    const sessionId = req.headers['x-twilio-call-sid'] || `session_${Date.now()}`;
    let session = sessions.get(sessionId) || { transcript: '', streamSid: null };
    sessions.set(sessionId, session);

    const openAiWs = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01', {
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "OpenAI-Beta": "realtime=v1"
      }
    });

    const initializeSession = () => {
      const sessionUpdate = {
        type: 'session.update',
        session: {
          turn_detection: { type: 'server_vad' },
          input_audio_format: 'g711_ulaw',
          output_audio_format: 'g711_ulaw',
          voice: VOICE,
          instructions: SYSTEM_MESSAGE,
          modalities: ["text", "audio"],
          temperature: 0.8,
          input_audio_transcription: {
            "model": "whisper-1"
          },
        }
      };

      console.log('Sending session update:', JSON.stringify(sessionUpdate));
      openAiWs.send(JSON.stringify(sessionUpdate));
      sendInitialConversationItem();
    };

    // Send initial conversation item if AI talks first
    const sendInitialConversationItem = () => {
      const initialConversationItem = {
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: 'Greet the user with “Hi, this is The senior software engineer. How can I help?”'
            }
          ]
        }
      };
      openAiWs.send(JSON.stringify(initialConversationItem));
      openAiWs.send(JSON.stringify({ type: 'response.create' }));
    };

    // Open event for OpenAI WebSocket
    openAiWs.on('open', () => {
      console.log('Connected to the OpenAI Realtime API');
      setTimeout(initializeSession, 100); // Ensure connection stability, send after a second
    });

    // Listen for messages from the OpenAI WebSocket
    openAiWs.on('message', (data) => {
      try {
        const response = JSON.parse(data);

        if (LOG_EVENT_TYPES.includes(response.type)) {
          console.log(`Received event: ${response.type}`, response);
        }

        // User message transcription handling
        if (response.type === 'conversation.item.input_audio_transcription.completed') {
          const userMessage = response.transcript.trim();
          session.transcript += `👨‍💼 User: ${userMessage}\n`;
          console.log(`User (${sessionId}): ${userMessage}`);
        }

        // Agent message handling
        if (response.type === 'response.done') {
          const agentMessage = response.response.output[0]?.content?.find(content => content.transcript)?.transcript || 'Agent message not found';
          session.transcript += `🎙️ Agent: ${agentMessage}\n`;
          console.log(`Agent (${sessionId}): ${agentMessage}`);
        }

        if (response.type === 'session.updated') {
          console.log('Session updated successfully:', response);
        }

        if (response.type === 'response.audio.delta' && response.delta) {
          const audioDelta = {
            event: 'media',
            streamSid: session.streamSid,
            media: { payload: Buffer.from(response.delta, 'base64').toString('base64') }
          };
          connection.send(JSON.stringify(audioDelta));
        }

        if (response.type === "input_audio_buffer.speech_started") {
          console.log("Speech Start:", response.type);
          // Clear any ongoing speech on Twilio side
          connection.send(
            JSON.stringify({
              streamSid: session.streamSid,
              event: "clear",
            })
          );
          console.log("Cancelling AI speech from the server");

          // Send interrupt message to OpenAI to cancel ongoing response
          const interruptMessage = {
            type: "response.cancel",
          };
          openAiWs.send(JSON.stringify(interruptMessage));
        }
      } catch (error) {
        console.error('Error processing OpenAI message:', error, 'Raw message:', data);
      }
    });

    // Handle incoming messages from Twilio
    connection.on('message', (message) => {
      try {
        const data = JSON.parse(message);

        switch (data.event) {
          case 'media':
            if (openAiWs.readyState === WebSocket.OPEN) {
              const audioAppend = {
                type: 'input_audio_buffer.append',
                audio: data.media.payload
              };

              openAiWs.send(JSON.stringify(audioAppend));
            }
            break;
          case 'start':
            session.streamSid = data.start.streamSid;
            console.log('Incoming stream has started', session.streamSid);
            break;
          default:
            console.log('Received non-media event:', data.event);
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error, 'Message:', message);
      }
    });

    // Handle connection close and log transcript
    connection.on('close', async () => {
      if (openAiWs.readyState === WebSocket.OPEN) openAiWs.close();
      console.log(`Client disconnected (${sessionId}).`);
      session.transcript = cleanTranscript(session.transcript);
      console.log('Full Transcript:');
      console.log(session.transcript);

      await processTranscriptAndSend(session.transcript, sessionId);

      // Clean up the session
      sessions.delete(sessionId);
    });

    // Handle WebSocket close and errors
    openAiWs.on('close', () => {
      console.log('Disconnected from the OpenAI Realtime API');
    });

    openAiWs.on('error', (error) => {
      console.error('Error in the OpenAI WebSocket:', error);
    });
  });
});

fastify.listen({ port: PORT }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server is listening on port ${PORT}`);
});

// Remove "Agent: Agent message not found" lines and any resulting empty lines
function cleanTranscript(transcript) {
  return transcript
    .split('\n')
    .filter(line => !line.includes('Agent: Agent message not found'))
    .filter(line => line.trim() !== '')
    .join('\n\n');
}


// Function to make ChatGPT API completion call with structured outputs
async function makeChatGPTCompletion(transcript) {
  console.log('Starting ChatGPT API call...');
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "gpt-4o-2024-08-06",
        messages: [
          { "role": "system", "content": "Extract customer details: name and address from the transcript. Do not invent any information; if the customer's name or address cannot be found, set the value to 'NONE'." },
          { "role": "user", "content": transcript }
        ],
        response_format: {
          "type": "json_schema",
          "json_schema": {
            "name": "customer_details_extraction",
            "schema": {
              "type": "object",
              "properties": {
                "customerName": { "type": "string", "default": "NONE" },
                "customerAddress": { "type": "string", "default": "NONE" }
              },
              "required": ["customerName", "customerAddress"]
            }
          }
        }
      })
    });

    console.log('ChatGPT API response status:', response.status);
    const data = await response.json();
    console.log('Full ChatGPT API response:', JSON.stringify(data, null, 2));
    return data;
  } catch (error) {
    console.error('Error making ChatGPT completion call:', error);
    throw error;
  }
}

// Main function to extract and send customer details
async function processTranscriptAndSend(transcript, sessionId = null) {
  console.log(`Starting transcript processing for session ${sessionId}...`);
  try {
    // Make the ChatGPT completion call
    const result = await makeChatGPTCompletion(transcript);

    if (result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content) {
      try {
        const parsedContent = JSON.parse(result.choices[0].message.content);
        console.log('Parsed content:', JSON.stringify(parsedContent, null, 2));

        if (parsedContent && callerNumber) {
          console.log('customerName', parsedContent.customerName)
          console.log('customerAddress', parsedContent.customerAddress)
          // Here you can do whatever you want with this data, save them in a db or sth else...

        } else {
          console.error('Unexpected JSON structure in ChatGPT response');
        }
      } catch (parseError) {
        console.error('Error parsing JSON from ChatGPT response:', parseError);
      }
    } else {
      console.error('Unexpected response structure from ChatGPT API');
    }

  } catch (error) {
    console.error('Error in processTranscriptAndSend:', error);
  }
}