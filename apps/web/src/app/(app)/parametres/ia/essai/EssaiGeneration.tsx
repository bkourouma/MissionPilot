"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BoutonGenerationIa } from "../../../../../components/ia/BoutonGenerationIa";
import { useLangue, useT } from "../../../../../components/i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const router = useRouter();
  const [nom, setNom] = useState(prompts[0]?.nom ?? "");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [termes, setTermes] = useState("");
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const refZone = useRef<HTMLDivElement>(null);
  const prompt = prompts.find((p) => p.nom === nom);

  if (!prompt) {
    return (
      <EtatVide titre={t("Aucun prompt d'exemple actif", "No active example prompt")}>
        {t(
          "Les prompts d'exemple du cabinet apparaissent ici dès qu'une version est active.",
          "The firm's example prompts appear here as soon as a version is active.",
        )}
      </EtatVide>
    );
  }
  const aSaisir = variablesASaisir(prompt);

  function preparer(): DemandeGenerationIa | null {
    if (!prompt) return null;
    const e: Record<string, string> = {};
    const vars = Object.fromEntries(aSaisir.map((v) => [v, (variables[v] ?? "").trim()]));
    for (const [v, valeur] of Object.entries(vars)) {
      if (valeur === "") e[`var_${v}`] = t("Renseignez ce texte.", "Fill in this text.");
    }
    const termesLus = lireTermesSensibles(termes, langue);
    if (!termesLus.ok && termesLus.erreurs.termes) e.termes = termesLus.erreurs.termes;
    setErreurs(e);
    if (Object.keys(e).length > 0 || !termesLus.ok) {
      // Après le rendu des erreurs : focus sur le premier champ refusé.
      setTimeout(() =>
        refZone.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return null;
    }
    return {
      prompt_nom: prompt.nom,
      variables: vars,
      termes_sensibles: termesLus.charge,
      mode: "file",
    };
  }

  return (
    <div ref={refZone} className="mp-formulaire">
      <div className="mp-grille-champs">
        <Select
          libelle={t("Prompt d'exemple", "Example prompt")}
          options={prompts.map((p) => ({
            valeur: p.nom,
            libelle: `${p.nom} — ${libelleTache(p.tache, langue)} (version ${p.version})`,
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
          libelle={
            v === "texte"
              ? t("Texte à traiter", "Text to process")
              : t(`Variable « ${v} »`, `Variable "${v}"`)
          }
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
        libelle={t(
          "Noms à masquer avant l'envoi (facultatif)",
          "Names to mask before sending (optional)",
        )}
        aide={t(
          "Un par ligne : personnes, entreprises, lieux. Ils sont remplacés par des jetons avant l'envoi au fournisseur, puis rétablis dans la réponse. E-mails, téléphones, IBAN et identifiants fiscaux sont masqués d'office.",
          "One per line: people, companies, places. They are replaced by tokens before being sent to the provider, then restored in the response. E-mails, phone numbers, IBANs and tax identifiers are masked automatically.",
        )}
        rows={3}
        value={termes}
        onChange={(ev) => setTermes(ev.target.value)}
        erreur={erreurs.termes}
      />
      <BoutonGenerationIa
        demande={preparer}
        libelle={t("Lancer l'essai", "Run the test")}
        onGeneree={(g) =>
          router.push(`/parametres/ia/essai?generation=${encodeURIComponent(g.id)}`)
        }
      />
    </div>
  );
}
