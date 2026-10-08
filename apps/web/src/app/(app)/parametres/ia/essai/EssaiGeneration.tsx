"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BoutonGenerationIa } from "../../../../../components/ia/BoutonGenerationIa";
import { EtatVide } from "../../../../../components/ui/EtatListe";
import { Select } from "../../../../../components/ui/Select";
import { ZoneTexte } from "../../../../../components/ui/ZoneTexte";
import { libelleTache, variablesASaisir, type PromptIa } from "../../../../../lib/ia";
import { lireTermesSensibles, type DemandeGenerationIa } from "../../../../../lib/ia-contenu";

/**
 * Essai d'un prompt « exemple » (seuls admis par la génération manuelle). Aucun chiffre n'est
 * fourni : tout nombre produit par le modèle est donc signalé « non vérifié ».
 */
export function EssaiGeneration({ prompts }: { prompts: readonly PromptIa[] }) {
  const router = useRouter();
  const [nom, setNom] = useState(prompts[0]?.nom ?? "");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [termes, setTermes] = useState("");
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const refZone = useRef<HTMLDivElement>(null);
  const prompt = prompts.find((p) => p.nom === nom);

  if (!prompt) {
    return (
      <EtatVide titre="Aucun prompt d'exemple actif">
        Les prompts d&apos;exemple du cabinet apparaissent ici dès qu&apos;une version est active.
      </EtatVide>
    );
  }
  const aSaisir = variablesASaisir(prompt);

  function preparer(): DemandeGenerationIa | null {
    if (!prompt) return null;
    const e: Record<string, string> = {};
    const vars = Object.fromEntries(aSaisir.map((v) => [v, (variables[v] ?? "").trim()]));
    for (const [v, valeur] of Object.entries(vars)) {
      if (valeur === "") e[`var_${v}`] = "Renseignez ce texte.";
    }
    const t = lireTermesSensibles(termes);
    if (!t.ok && t.erreurs.termes) e.termes = t.erreurs.termes;
    setErreurs(e);
    if (Object.keys(e).length > 0 || !t.ok) {
      // Après le rendu des erreurs : focus sur le premier champ refusé.
      setTimeout(() =>
        refZone.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return null;
    }
    return { prompt_nom: prompt.nom, variables: vars, termes_sensibles: t.charge, mode: "file" };
  }

  return (
    <div ref={refZone} className="mp-formulaire">
      <div className="mp-grille-champs">
        <Select
          libelle="Prompt d'exemple"
          options={prompts.map((p) => ({
            valeur: p.nom,
            libelle: `${p.nom} — ${libelleTache(p.tache)} (version ${p.version})`,
          }))}
          value={nom}
          onChange={(ev) => {
            setNom(ev.target.value);
            setErreurs({});
          }}
          aide={prompt.description || undefined}
        />
      </div>
      {aSaisir.map((v) => (
        <ZoneTexte
          key={`${nom}-${v}`}
          libelle={v === "texte" ? "Texte à traiter" : `Variable « ${v} »`}
          required
          rows={6}
          maxLength={50_000}
          lang="fr"
          value={variables[v] ?? ""}
          onChange={(ev) => setVariables((x) => ({ ...x, [v]: ev.target.value }))}
          erreur={erreurs[`var_${v}`]}
        />
      ))}
      <ZoneTexte
        libelle="Noms à masquer avant l'envoi (facultatif)"
        aide="Un par ligne : personnes, entreprises, lieux. Ils sont remplacés par des jetons avant l'envoi au fournisseur, puis rétablis dans la réponse. E-mails, téléphones, IBAN et identifiants fiscaux sont masqués d'office."
        rows={3}
        value={termes}
        onChange={(ev) => setTermes(ev.target.value)}
        erreur={erreurs.termes}
      />
      <BoutonGenerationIa
        demande={preparer}
        libelle="Lancer l'essai"
        onGeneree={(g) =>
          router.push(`/parametres/ia/essai?generation=${encodeURIComponent(g.id)}`)
        }
      />
    </div>
  );
}
