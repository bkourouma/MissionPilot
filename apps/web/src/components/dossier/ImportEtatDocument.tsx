"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEVISES } from "@missionpilot/shared";
import { Alerte } from "../ui/Alerte";
import { Champ } from "../ui/Champ";
import { Select } from "../ui/Select";
import { TeleversementDocument } from "../ingestion/TeleversementDocument";
import { validerImportEtat, type ChampImportEtat, type SaisieImportEtat } from "../../lib/dossier";
import type { Devise } from "../../lib/format";
import {
  cheminApiDossierIngestion,
  TEXTE_ACCEPTATION_AUTO,
  TEXTE_TOLERANCE,
} from "../../lib/ingestion";

/**
 * Import d'un état financier lu dans un PDF ou un classeur (DOS-03). Le document est lu en
 * arrière-plan ; l'état naît ensuite avec les contrôles du moteur (acceptation automatique
 * seulement si tout passe, sinon revue). Un PDF scanné n'est pas lu.
 */
export function ImportEtatDocument({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [s, setS] = useState<SaisieImportEtat>({
    exercice: String(new Date().getFullYear() - 1),
    date_cloture: "",
    devise: "XOF",
    tolerance: "0",
  });
  const [erreurs, setErreurs] = useState<Partial<Record<ChampImportEtat, string>>>({});
  const maj = <K extends keyof SaisieImportEtat>(k: K, v: SaisieImportEtat[K]) =>
    setS((x) => ({ ...x, [k]: v }));

  // Les champs d'en-tête sont contrôlés comme pour l'import Excel ; le fichier l'est par le composant.
  function entetesValides(): boolean {
    const v = validerImportEtat(s, { name: "x.xlsx", size: 1 });
    if (v.ok) {
      setErreurs({});
      return true;
    }
    setErreurs({ ...v.erreurs, fichier: undefined });
    return false;
  }

  const tolerance = s.tolerance.trim() === "" ? 0 : Number(s.tolerance.trim());

  return (
    <div>
      <Alerte tonalite="info" titre="L'IA propose, les contrôles décident" annonce="aucune">
        <p>{TEXTE_ACCEPTATION_AUTO}</p>
        <p>
          Un PDF scanné (image sans texte) n&apos;est pas lu : fournissez un PDF avec texte ou un
          classeur Excel.
        </p>
      </Alerte>
      <TeleversementDocument
        chemin={`${cheminApiDossierIngestion(clientId)}/etats-financiers/document`}
        requete={{
          exercice: s.exercice.trim(),
          date_cloture: s.date_cloture,
          devise: s.devise,
          tolerance: Number.isFinite(tolerance) ? tolerance : 0,
        }}
        libelleBouton="Importer et lire le document"
        avantEnvoi={entetesValides}
        onCree={() => router.refresh()}
      >
        <div className="mp-grille-champs">
          <Champ
            libelle="Exercice"
            required
            inputMode="numeric"
            maxLength={4}
            value={s.exercice}
            onChange={(e) => maj("exercice", e.target.value)}
            erreur={erreurs.exercice}
          />
          <Champ
            libelle="Date de clôture"
            type="date"
            required
            value={s.date_cloture}
            onChange={(e) => maj("date_cloture", e.target.value)}
            erreur={erreurs.date_cloture}
          />
          <Select
            libelle="Devise"
            options={DEVISES.map((d) => ({ valeur: d, libelle: d }))}
            value={s.devise}
            onChange={(e) => maj("devise", e.target.value as Devise)}
          />
          <Champ
            libelle="Tolérance des contrôles"
            inputMode="numeric"
            value={s.tolerance}
            onChange={(e) => maj("tolerance", e.target.value)}
            erreur={erreurs.tolerance}
            aide={TEXTE_TOLERANCE}
          />
        </div>
      </TeleversementDocument>
    </div>
  );
}
