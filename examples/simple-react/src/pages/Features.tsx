const features = [
  {
    title: 'Chat Widget',
    description: 'Composant React prêt à l\'emploi avec personnalisation complète du style et du comportement.',
  },
  {
    title: 'Fonctions côté client',
    description: 'Enregistrez des fonctions que l\'IA peut appeler pour interagir avec votre application (navigation, notifications, accès aux données).',
  },
  {
    title: 'Streaming SSE',
    description: 'Les réponses de l\'assistant arrivent en temps réel grâce au streaming Server-Sent Events.',
  },
  {
    title: 'Upload de fichiers',
    description: 'Permettez aux utilisateurs de joindre des fichiers à leurs messages pour un support contextuel.',
  },
  {
    title: 'Multi-conversations',
    description: 'Gérez plusieurs conversations simultanées avec historique et reprise de session.',
  },
  {
    title: 'Navigation intelligente',
    description: 'L\'IA peut rediriger l\'utilisateur vers la bonne page de votre application en fonction de sa question.',
  },
];

export default function Features() {
  return (
    <div className="page">
      <h2>Fonctionnalités</h2>
      <div className="features-grid">
        {features.map((f) => (
          <div key={f.title} className="feature-card">
            <h3>{f.title}</h3>
            <p>{f.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
