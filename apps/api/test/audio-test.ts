import {
  fabriquerConteneurAudioSimule,
  type ContenuConteneurTest,
} from "../src/canaux/transcripteur-simule.js";

/*
 * Helper des tests (SPEC-3c §4.2) : fabrique un CONTENEUR DE TEST accepté par le transcripteur
 * simulé (en-tête OGG de 27 octets, ligne « MPSIM1 », JSON). Ce n'est pas de l'audio : aucune donnée
 * réelle de personne n'entre.
 */
export function fabriquerAudioDeTest(c: ContenuConteneurTest): Buffer {
  return fabriquerConteneurAudioSimule(c);
}

/** Faux audio « réel » : en-tête OGG valide suivi d'octets quelconques, sans marque de test. */
export function fauxAudioReel(): Buffer {
  const entete = Buffer.alloc(27);
  entete.write("OggS", 0, "ascii");
  return Buffer.concat([entete, Buffer.from("octets-quelconques-sans-marque-de-test", "utf8")]);
}
