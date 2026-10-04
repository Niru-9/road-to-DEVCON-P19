Stop Making Me Explain Myself
Ana is dyslexic and reads Portuguese far more comfortably than English. Every AI assistant she tries starts from zero: walls of text, long sentences, English by default. She has typed "short sentences, Portuguese, no long paragraphs" into a dozen settings pages, and every one of those settings lives in someone else's database.

She already has an ENS name. She wants to write her preferences down once, on a name she controls, and use an assistant that simply honours them, so the next assistant she tries could honour them too.

What you'll learn

Reading ENS text records, and handling names whose records are missing, unset, or nonsense
Turning public, user-controlled data into safe steering for a model
Proving with recorded cases that personalization actually changes the output
Building against any model provider, free tiers included
What to do

Decide which 3–6 preferences are worth carrying between assistants (language, reading level, answer length, accessibility needs, topics to avoid: your call), and define them as ENS text record keys with allowed values. Document the format in your README.
Set those records on at least two Sepolia ENS names with clearly different preferences.
Build an assistant where someone enters their ENS name, asks questions, and gets answers that respect their preferences.
Use any model from any provider. Free tiers are enough; see the event prerequisites for options.
Record a few example cases in the repo showing the same question answered under different preferences.
Deliverable. A public GitHub repo containing the assistant, your documented preference format, the Sepolia names you tested with, and your recorded example cases.

Acceptance criteria

Ana types her ENS name once, and every answer arrives in short Portuguese sentences without her asking again.
8 scored test cases · 80 points are read straight off your code — open the Test cases tab to see exactly what they are before you build.

Suggested stack

viem
ENS on Sepolia
Any LLM (OpenAI-compatible API)
Zod or JSON Schema
Any web framework


agent harness
Get started
npx loopshouse add road-to-devcon-vii
Copy
Before you run it

Needs Node 20.12+ (22 LTS recommended) — check with node -v, and switch with nvm use 22if you're older. Sign-in opens in your browser (Google, GitHub, or an email code) — nothing to copy or paste.

Run it in your project directory — it installs this battle's agent skill and signs you in, then you build with your own coding agent.

How to use
Via CLI
Query this problem's knowledge graph straight from your terminal:

loops knowledge query --event road-to-devcon-vii --problem portable-ai-preferences -q "<your question>"
Copy
Via IDE
Once the skill is installed, your coding agent knows this battle — just ask it in plain English inside your IDE:

Ask the "Stop Making Me Explain Myself" knowledge graph: <your question>


Test Cases 
1.No ENS record value is interpolated into the system prompt

20
Passes if The system/instruction message is composed only of app-authored strings (which may be selected by validated preference values); no raw text record content is inserted into it.

Fails if Any raw text record content is inserted into the system/instruction message, OR instructions and user content are concatenated into one undifferentiated prompt string, OR no model call exists.

2.Each preference value is checked against an allowlist

12
Passes if Every preference value read from ENS is checked against a defined set of allowed values or a bounded type, and values outside it are discarded or replaced.

Fails if Any preference value is used without being checked against a defined set of allowed values, OR preferences are never read from ENS.

3.An unset record falls back to a named default

10
Passes if An explicit branch assigns a defined default value whenever a preference record is unset or empty.

Fails if There is no explicit handling of an unset record (null flows into logic or the prompt), OR no ENS record read exists.

4.The entered name is normalized before resolution

8
Passes if The user-entered name passes through an ENSIP-15 normalize function before any ENS resolution call.

Fails if The raw user input reaches an ENS resolution call without normalization, OR the app has no ENS resolution call.

5.The model request has an explicit timeout

7
Passes if The model request is bounded by an explicit timeout.

Fails if The model request has no timeout, OR no model call exists.

6.Recorded cases pair one question with two or more preference sets

10
Passes if At least one recorded case pairs the same user question with two or more different preference sets, each with a stated expected property (language, maximum length, reading level, or similar).

Fails if No recorded cases exist, OR every recorded case uses a single preference set, OR cases state no expected property.

7.Model id and provider endpoint are read from configuration

5
Passes if The model identifier and the provider endpoint are read from environment or config (a fallback default is allowed).

Fails if The model identifier or provider endpoint is only a hardcoded literal at the call site, OR no model call exists.

8.No credential appears in any tracked file

8
Passes if No real credential, API key, private key, or authenticated URL appears in any tracked file.

Fails if Any real credential, API key, private key, or authenticated URL appears in any tracked file.