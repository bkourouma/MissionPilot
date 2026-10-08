"use client";

import { useRouter } from "next/navigation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { api } from "../../../../lib/api";
import { messageQuestionnaire, type VersionDetail } from "../../../../lib/questionnaires";

/**
 * Nouvelle version brouillon d'un modèle, copie de la dernière version (l'API refuse s'il y a
 * déjà un brouillon : 409). Ouvre l'éditeur de la version créée.
 */
export function NouvelleVersion({ modeleId, prochaine }: { modeleId: string; prochaine: number }) {
  const router = useRouter();
  const f = useFormulaire<never>();
  return (
    <div className="mp-pile">
      <div>
        <Bouton
          icone="plus"
          chargement={f.enCours}
          texteChargement="Création de la version…"
          onClick={() =>
            void f.envoyer(
              { ok: true, charge: {} },
              (c) =>
                api.post<VersionDetail>(
                  `/api/questionnaires/modeles/${encodeURIComponent(modeleId)}/versions`,
                  c,
                ),
              {
                rafraichir: false,
                messageSpecifique: messageQuestionnaire,
                apres: (v) => router.push(`/questionnaires/versions/${v.id}`),
              },
            )
          }
        >
          {`Créer la version ${prochaine}`}
        </Bouton>
      </div>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Création de la version impossible"
      />
    </div>
  );
}
