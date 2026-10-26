<!-- cairn preset: angular — fills {{> stack/qa-source }} (qa-architect P.3). -->
Read the target in full:

- The component class — inputs, outputs, public methods, observable streams, route params
- The template — current markup; identify the elements a user interacts with
- The stylesheet — only if styling affects visibility or interaction

Then the context docs for the area: `ai/contexts/pages/**` (business logic of the
page), `ai/contexts/components/**` (component contracts), `ai/contexts/entities/**`
(entity shape if the page reads or writes one). They describe what the page is
supposed to do, which drives what to assert.
