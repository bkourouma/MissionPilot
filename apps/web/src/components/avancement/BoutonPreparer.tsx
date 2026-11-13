"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminApiGenerationAvancement,
  hrefRapportAvancement,
  messageAvancement,
  type RapportAvancement,
} from "../../lib/avancement";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";

/**
 * Génération manuelle du rapport de la semaine courante (idempotente : si le brouillon existe déjà,
 * l'API le renvoie). Ouvre ensuite le rapport pour relecture. Aucun envoi au client.
 */
export function BoutonPreparer({ missionId }: { missionId: string }) {
  const router = useRouter();
  const t = useT();
  const langue = useLangue();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const verrou = useRef(false);
  const refAlerte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function preparer() {
    if (verrou.current) return;
    verrou.current = true;
    setEnCours(true);
    setErreur(null);
    try {
      const r = await api.post<RapportAvancement>(cheminApiGenerationAvancement(missionId), {});
      router.push(hrefRapportAvancement(missionId, r.id));
    } catch (e) {
      setErreur(messageAvancement(e, langue));
    } finally {
      verrou.current = false;
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={erreur}
        refAlerte={refAlerte}
        titreErreur={t("Le rapport n'a pas pu être préparé", "The report could not be prepared")}
      />
      <div>
        <Bouton
          chargement={enCours}
          texteChargement={t("Préparation…", "Preparing…")}
          icone="plus"
          onClick={() => void preparer()}
        >
          {t("Préparer le rapport de cette semaine", "Prepare this week's report")}
        </Bouton>
      </div>
    </div>
  );
}
