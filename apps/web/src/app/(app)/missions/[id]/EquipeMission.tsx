"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { useT } from "../../../../components/i18n/FournisseurLangue";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { Select, type OptionSelect } from "../../../../components/ui/Select";
import { api } from "../../../../lib/api";

export interface EquipeMissionProps {
  missionId: string;
  equipe: { utilisateur_id: string; nom: string }[];
  personnes: readonly OptionSelect[];
  modifiable: boolean;
}

/** Membres de l'équipe : ils voient la mission sans la modifier. */
export function EquipeMission({ missionId, equipe, personnes, modifiable }: EquipeMissionProps) {
  const t = useT();
  const [membre, setMembre] = useState("");
  const f = useFormulaire<"utilisateur_id">();
  const chemin = `/api/missions/${encodeURIComponent(missionId)}/equipe`;
  const disponibles = personnes.filter((p) => !equipe.some((e) => e.utilisateur_id === p.valeur));

  async function ajouter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      membre
        ? { ok: true, charge: { utilisateur_id: membre } }
        : {
            ok: false,
            erreurs: { utilisateur_id: t("Choisissez une personne.", "Choose a person.") },
          },
      (c) => api.post(chemin, c),
      { succes: t("Membre ajouté.", "Member added."), apres: () => setMembre("") },
    );
  }

  return (
    <Carte titre={t("Équipe", "Team")}>
      <div className="mp-pile">
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur={t("Modification de l'équipe impossible", "Team change not possible")}
        />
        {equipe.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun membre en plus du directeur et du chef de mission.",
              "No members besides the director and the engagement manager.",
            )}
          </p>
        ) : (
          <ul className="mp-liste-lignes">
            {equipe.map((e) => (
              <li key={e.utilisateur_id} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">{e.nom}</span>
                {modifiable ? (
                  <BoutonConfirmation
                    libelle={t("Retirer", "Remove")}
                    variante="discret"
                    icone="corbeille"
                    ariaLabel={t(`Retirer ${e.nom} de l'équipe`, `Remove ${e.nom} from the team`)}
                    question={t(`Retirer ${e.nom} de l'équipe ?`, `Remove ${e.nom} from the team?`)}
                    libelleConfirmation={t("Oui, retirer", "Yes, remove")}
                    texteChargement={t("Retrait…", "Removing…")}
                    action={() =>
                      f.envoyer({ ok: true, charge: null }, () =>
                        api.supprimer(`${chemin}/${encodeURIComponent(e.utilisateur_id)}`),
                      )
                    }
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {modifiable ? (
          <form
            ref={f.refFormulaire}
            className="mp-formulaire mp-formulaire--ligne"
            noValidate
            onSubmit={ajouter}
            aria-label={t("Ajouter un membre à l'équipe", "Add a member to the team")}
          >
            <div className="mp-ligne-action">
              <Select
                libelle={t("Ajouter un membre", "Add a member")}
                name="utilisateur_id"
                options={disponibles}
                invite={
                  disponibles.length
                    ? t("Choisir une personne…", "Choose a person…")
                    : t("Aucune personne à ajouter", "No one to add")
                }
                value={membre}
                onChange={(e) => setMembre(e.target.value)}
                erreur={f.erreurs.utilisateur_id}
              />
              <Bouton
                type="submit"
                variante="secondaire"
                icone="plus"
                chargement={f.enCours}
                texteChargement={t("Ajout…", "Adding…")}
              >
                {t("Ajouter", "Add")}
              </Bouton>
            </div>
          </form>
        ) : null}
      </div>
    </Carte>
  );
}
