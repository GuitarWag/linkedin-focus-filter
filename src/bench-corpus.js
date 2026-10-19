// Shared eval corpus: real posts from the feed plus a few clear-cut cases,
// each labelled with the verdict a human would want for these interests.
export const MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
export const INTERESTS = "software engineer, ai, sql, cloud";

export const POSTS = [
  {
    label: "architect-course-spam",
    want: "NO",
    text: `Senior Developer? Your career GPS is lying to you 📍 It keeps routing you through the same loop: New framework. New job. Same role. Estimated arrival at career satisfaction: Never. But there's a route your GPS doesn't show you. The one that the architects currently working at fortune 500 companies took to escape the developer loop. Direct path. No detours. 15 weeks to destination. 🏃💨 Forget the endless loop of lateral moves and tiny raises. Our Software Architecture Course is the route recalculation you've been looking for. Limited seats available only to experienced senior developers. Then click here to learn more 👇`,
  },
  {
    label: "big-o-notation",
    want: "YES",
    text: `⏱️ Big-O Notation, finally explained without the headache. If DSA techniques are the "how," Big-O is the "how fast." It's the language we use to describe how your code scales as the input grows. Here's the complexity ladder: O(1) constant — accessing an array index, hash map lookup. O(log n) logarithmic — binary search. O(n) linear — a single loop through an array. O(n log n) — merge sort, quick sort, heap sort. O(n²) quadratic — a loop inside a loop. O(2ⁿ) exponential — naive recursive Fibonacci. Drop the constants, keep the dominant term. #DSA #Algorithms`,
  },
  {
    label: "workplace-safety-pt",
    want: "NO",
    text: `A armadilha do hábito - Quando o risco vira rotina. Ver alguém sobre uma viga suspensa assusta, mas esse comportamento quase nunca vem do desejo de se ferir. Ele nasce de falhas cognitivas e pressões silenciosas da mente humana. Normalização do desvio: "Fiz assim antes e nada aconteceu" transforma o erro em rotina. Regras e placas não mudam comportamentos, elas apenas delimitam fronteiras. #SegurancaComportamental #FatorHumano`,
  },
  {
    label: "festival-promo-pt",
    want: "NO",
    text: `110 mil pessoas presentes no MEO KALORAMA! 💙 E como naming sponsor, a MEO garantiu que todos os festivaleiros estavam conectados no Parque da Bela Vista, ao longo dos 3 dias de festival. ✨ Deslize para ver os números! 👉 #MEO #WeAreMEOKALORAMA #FestivalMEO`,
  },
  {
    label: "ai-as-infrastructure",
    want: "YES",
    text: `I thought I understood AI. I didn't. I'd used ChatGPT, Claude, built workflows and automated bits of work, so I thought I had a decent handle on where it was all going. The gap between casually using AI and actually building around it is enormous. Research, analysis, recruitment, operations, systems - once you start going deeper, you realise just how much capability is sitting there. And then you get to agents, which feels like a different category altogether. That's when you stop thinking about AI as a tool and start thinking about it as infrastructure.`,
  },
  {
    label: "hiring-post",
    want: "NO",
    text: `We're hiring! 🚀 Our team is growing and we're looking for talented people to join us. Multiple openings across engineering, product and design. Great culture, competitive salary, remote friendly. If you're passionate about building great products, DM me or apply through the link below. Please share with your network! #hiring #jobs #opportunity`,
  },
  {
    label: "motivational",
    want: "NO",
    text: `5 years ago I was rejected from 47 interviews. Today I lead a team of 30. Here's what I learned: 1. Rejection is redirection. 2. Your network is your net worth. 3. Consistency beats talent. 4. Never stop learning. 5. Believe in yourself even when nobody else does. The only person who can stop you is you. Agree? ♻️ Repost to inspire someone today.`,
  },
  {
    label: "postgres-deep-dive",
    want: "YES",
    text: `Spent the week tuning a Postgres query that was taking 45 seconds. Turned out the planner was choosing a nested loop join over a hash join because the statistics on the partitioned table were stale. Ran ANALYZE, bumped default_statistics_target to 500 on the hot columns, and added a covering index on (tenant_id, created_at) INCLUDING (status). Down to 180ms. Before you reach for a read replica or a cache layer, read the EXPLAIN ANALYZE output properly.`,
  },
  {
    label: "k8s-migration",
    want: "YES",
    text: `We moved 40 services from ECS to EKS over four months. What actually mattered: pod disruption budgets stopped our rolling deploys from taking down quorum-based services, and switching from the in-tree EBS driver to the CSI driver fixed the volume detach storms. Karpenter cut our node bill by 30% versus managed node groups, but you need to get your topology spread constraints right or it will happily pack everything onto one AZ.`,
  },
  {
    label: "llm-eval-writeup",
    want: "YES",
    text: `Built an eval harness for our RAG pipeline this week. Key insight: retrieval precision at k=5 mattered far more than swapping the generation model. We were chasing a 2% gain from a bigger LLM while our chunking strategy was throwing away half the relevant context. Fixed the chunk overlap, added a reranker, and answer accuracy jumped 18 points. Measure the retrieval layer before you touch the model.`,
  },
  {
    label: "book-recommendation",
    want: "NO",
    text: `Just finished reading Atomic Habits and it completely changed how I think about productivity. The core idea is that you don't rise to the level of your goals, you fall to the level of your systems. Highly recommend for anyone looking to build better routines this year. What's the best book you've read recently? Drop it in the comments 👇`,
  },
  // --- adversarial cases, written to attack the junk rules rather than to
  // --- pass them: wanted content that happens to use junk-ish phrasing.
  {
    label: "genuine-launch",
    want: "YES",
    text: `Thrilled to announce we've open-sourced our vector database. Written in Rust, handles 10k queries per second on a single node, and the index format is memory-mappable so cold starts are near-instant. We wrote up the architecture and the benchmark methodology in the repo, including where we lose to pgvector on recall. MIT licensed, contributions welcome.`,
  },
  {
    label: "technical-post-with-hiring-aside",
    want: "YES",
    text: `We rewrote our event ingestion pipeline in Go last quarter. The old Python consumer was spending 60% of its time in JSON deserialisation, so we moved to a streaming decoder and batched the Postgres writes with COPY instead of individual INSERTs. Throughput went from 12k to 48k events per second on the same instance size, and p99 latency dropped from 800ms to 90ms. Full writeup with flame graphs on our engineering blog. By the way, we're hiring backend engineers if this sounds like your kind of problem.`,
  },
  // --- generalisation probes: on-topic posts whose vocabulary a keyword list
  // --- would have to have enumerated in advance. These exist to test whether
  // --- the model earns its keep over a hand-written word list.
  {
    label: "columnar-execution",
    want: "YES",
    text: `Spent the weekend reading how DuckDB implements window functions. It materialises the partition into a sorted run, then walks it with a moving frame instead of re-scanning per row, which is why RANGE frames stay linear rather than quadratic. The vectorised execution model means each operator hands the next one a batch of a couple of thousand values, so the per-row interpreter overhead that kills row-at-a-time engines mostly disappears. Genuinely elegant piece of engineering.`,
  },
  {
    label: "service-mesh-capacity",
    want: "YES",
    text: `Capacity planning notes after six months running Nomad and Consul in production. Consul's gossip pool gets noisy past about 400 agents, so we sharded into two datacenters with mesh gateways between them and the CPU on the servers halved. Bin-packing on memory rather than CPU turned out to be the right call for our workload mix, and preemption on the lower-priority batch jobs keeps the fleet at roughly 70% utilisation without starving the latency-sensitive services.`,
  },
  {
    label: "contrastive-embeddings",
    want: "YES",
    text: `We swapped our retrieval encoder for one fine-tuned with a contrastive objective on in-domain pairs, using hard negatives mined from the existing index rather than random in-batch negatives. Recall@10 went up 14 points on our held-out set. The interesting part: temperature mattered more than batch size, which contradicts most of the papers we were working from. Also worth noting that triplet mining cost us more compute than the fine-tune itself.`,
  },
  {
    label: "woodworking-offtopic",
    want: "NO",
    text: `Finally finished the walnut dining table. Hand-cut mortise and tenon joinery throughout, no fasteners anywhere in the base. The top is a bookmatched slab I've had drying in the shop for three years, finished with six coats of hardwax oil rubbed back between coats. The hardest part was flattening the slab by hand once it was too wide for the planer sled. Twelve weekends well spent.`,
  },
  // --- probes aimed at the keyword baseline: off-topic posts that use the
  // --- generic words a keyword list relies on ("model", "agents", "index").
  {
    label: "fashion-shoot-offtopic",
    want: "NO",
    text: `Wrapped the autumn campaign shoot yesterday. The model was an absolute professional through eleven hours and three location changes, and the light on the coast in late September is worth every early call time. Grateful to the whole crew for making a tight schedule feel calm. Prints going up in stores next month.`,
  },
  {
    label: "inflation-index-offtopic",
    want: "NO",
    text: `The consumer price index came in hotter than expected again this morning, and our pricing model still assumes the old trajectory. Spent the afternoon with the commercial team reworking assumptions for next year's plan. Our agents in the northern region are already reporting pushback on the last increase, so there is not much headroom left before volume starts to move.`,
  },
  {
    label: "company-award",
    want: "NO",
    text: `Thrilled and humbled to share that our company has been named a Top Employer for the third year running! 🏆 This recognition belongs to every single member of our incredible team. None of this would be possible without your dedication, passion and hard work. Here's to many more milestones together! #proud #teamwork #award`,
  },
];
