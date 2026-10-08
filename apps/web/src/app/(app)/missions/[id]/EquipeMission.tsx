"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
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
  const [membre, setMembre] = useState("");
  const f = useFormulaire<"utilisateur_id">();
  const chemin = `/api/missions/${encodeURIComponent(missionId)}/equipe`;
  const disponibles = personnes.filter((p) => !equipe.some((e) => e.utilisateur_id === p.valeur));

  async function ajouter(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      membre
        ? { ok: true, charge: { utilisateur_id: membre } }
        : { ok: false, erreurs: { utilisateur_id: "Choisissez une personne." } },
      (c) => api.post(chemin, c),
      { succes: "Membre ajouté.", apres: () => setMembre("") },
    );
  }

  return (
    <Carte titre="Équipe">
      <div className="mp-pile">
        <RetourFormulaire
          erreur={f.erreurGlobale}
          succes={f.succes}
          refAlerte={f.refAlerte}
          titreErreur="Modification de l'équipe impossible"
        />
        {equipe.length === 0 ? (
          <p className="mp-texte-doux">Aucun membre en plus du directeur et du chef de mission.</p>
        ) : (
          <ul className="mp-liste-lignes">
            {equipe.map((e) => (
              <li key={e.utilisateur_id} className="mp-liste-lignes__ligne">
                <span className="mp-liste-lignes__texte">{e.nom}</span>
                {modifiable ? (
                  <BoutonConfirmation
                    libelle="Retirer"
                    variante="discret"
                    icone="corbeille"
                    ariaLabel={`Retirer ${e.nom} de l'équipe`}
                    question={`Retirer ${e.nom} de l'équipe ?`}
                    libelleConfirmation="Oui, retirer"
                    texteChargement="Retrait…"
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
            aria-label="Ajouter un membre à l'équipe"
          >
            <div className="mp-ligne-action">
              <Select
                libelle="Ajouter un membre"
                name="utilisateur_id"
                options={disponibles}
                invite={disponibles.length ? "Choisir une personne…" : "Aucune personne à ajouter"}
                value={membre}
                onChange={(e) => setMembre(e.target.value)}
                erreur={f.erreurs.utilisateur_id}
              />
              <Bouton
                type="submit"
                variante="secondaire"
                icone="plus"
                chargement={f.enCours}
                texteChargement="Ajout…"
              >
                Ajouter
              </Bouton>
            </div>
          </form>
        ) : null}
      </div>
    </Carte>
  );
}
